from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import FileResponse
from typing import Optional
import shutil
import uuid
import os
from pathlib import Path
from datetime import datetime

from database.connection import get_database
from database.job_posting_crud import get_job_posting_by_id, create_job_cv_file, add_cv_to_job
from cv_screener.cv_parser import parse_cv_file
from cv_screener.cv_extractor import extract_cv_information
from database.crud import create_interview_cv
from database.ranking_crud import create_candidate_ranking

# Import the new service
from services.interview_service import InterviewService, InterviewServiceContext

router = APIRouter(prefix="/interview", tags=["Interview"])

@router.post("/start-interview/{job_id}")
async def start_interview(
    job_id: str,
    cv_file: UploadFile = File(...),
    candidate_name: str = Form(...),
    email_address: str = Form(...),
    phone_number: str = Form(...),
    linkedin_profile: Optional[str] = Form(None),
    db=Depends(get_database)
):
    """
    Start a new interview by:
    1. Parsing the CV into structured JSON
    2. Fetching the Job Description
    3. Initializing the Interview Service state
    """
    try:
        # 1. Fetch Job Description
        job = await get_job_posting_by_id(db, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job posting not found")
            
        job_description = job.get("job_description", "")
        required_skills = job.get("skills", [])
        extra_instructions = job.get("extra_instructions", "Keep the interview conversational and focused on the job description.")

        # 2. Save and Parse CV
        session_id = str(uuid.uuid4())
        
        if not cv_file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are accepted")
            
        upload_dir = Path("uploads/interview_cvs")
        upload_dir.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_filename = f"{session_id}_{timestamp}_{cv_file.filename}"
        file_path = upload_dir / safe_filename
        
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(cv_file.file, buffer)
            
        # Parse text from CV
        try:
            cv_text = parse_cv_file(str(file_path))
        except Exception as e:
            print(f"Failed to parse CV text: {e}")
            cv_text = ""
            
        # Parse structured CV info required by the LLM
        cv_json = {}
        try:
            # We use an internal function or groq to structure the CV
            raw_json_str = extract_cv_information(cv_text) 
            import json
            if isinstance(raw_json_str, str):
                # Attempt to parse json structure out of the string
                import re
                json_match = re.search(r"\{.*\}", raw_json_str, re.DOTALL)
                if json_match:
                    cv_json = json.loads(json_match.group(0))
                else:
                    cv_json = {"summary": cv_text[:1000]}
            else:
                cv_json = raw_json_str
        except Exception as e:
            print(f"Failed structured extraction: {e}")
            cv_json = {"summary": cv_text[:1000]}

        # Store CV in Database
        try:
            with open(file_path, "rb") as f:
                file_content = f.read()
            
            cv_file_id = await create_job_cv_file(
                db, 
                job_id, 
                cv_file.filename, 
                file_content, 
                len(file_content)
            )
            await add_cv_to_job(db, job_id, cv_file_id)
        except Exception as e:
            print(f"Failed to store CV in database: {e}")
            cv_file_id = None

        # Store Candidate Info
        cv_data = {
            "candidate_name": candidate_name,
            "email_address": email_address,
            "phone_number": phone_number,
            "linkedin_profile": linkedin_profile,
            "cv_file_name": cv_file.filename,
            "cv_file_path": str(file_path),
            "job_id": job_id,
            "cv_text": cv_text[:2000]
        }
        
        # We reuse the create_interview_cv crud function for the candidate data
        candidate_obj_id = await create_interview_cv(db, session_id, cv_data)
        
        # 3. Create context and initialize session
        context = InterviewServiceContext(
            candidate_name=candidate_name,
            candidate_cv_json=cv_json,
            job_description=job_description,
            required_skills=required_skills,
            recruiter_extra_instructions=extra_instructions
        )
        
        # Instantiate service and create session
        # We need a global instance or pass it in. For FastAPI we might create it per request
        # but to keep state we need a singleton. So we import it from main.
        from main import get_interview_service
        service = get_interview_service()
        
        new_session_id = await service.initialize_session(context, job_id, str(candidate_obj_id))
        
        import asyncio
        from cv_screener.gemini_screener import GeminiCVScreener
        
        async def background_cv_scoring(job_id: str, candidate_id: str, candidate_name: str, email: str, job_desc: str, cv_data: dict, cv_text: str):
            try:
                screener = GeminiCVScreener()
                result = await screener.screen_cv_master(
                    job_description=job_desc,
                    cv_content=str(cv_data),
                    file_name=safe_filename
                )
                
                job_rec = await get_job_posting_by_id(db, job_id)
                recruiter_id = job_rec.get("recruiter_id", "") if job_rec else ""
                
                await create_candidate_ranking(
                    db=db,
                    job_posting_id=job_id,
                    recruiter_id=recruiter_id,
                    candidate_name=candidate_name,
                    rank=999, # Will be calculated on dashboard query
                    score=0, # final score calculated after interview
                    candidate_id=candidate_id,
                    email=email,
                    cv_score=result["overall_cv_score"],
                    cv_technical_score=result["technical_score"],
                    cv_experience_score=result["experience_score"],
                    cv_project_score=result["project_score"],
                    cv_education_score=result["education_score"],
                    interview_score=0,
                    technical_score=0,
                    communication_score=0,
                    confidence_score=0,
                    facial_recognition_score=0,
                    completion=10, # Interview started
                    interview_status="In Progress",
                    cv_data={"text": cv_text[:500], "full_analysis": result},
                    evaluation_details={"background_screening": result}
                )
            except Exception as e:
                print(f"Background CV scoring failed: {e}")

        # Fire and forget background CV scoring
        asyncio.create_task(
            background_cv_scoring(job_id, str(candidate_obj_id), candidate_name, email_address, job_description, cv_json, cv_text)
        )

        
        # Get the first question asynchronously
        # We process 'INIT' to trigger the greeting behavior
        full_response = ""
        async for chunk in service.process_input(new_session_id, "INIT"):
            full_response += chunk
            
        return {
            "success": True,
            "message": "Interview sequence initiated",
            "session_id": new_session_id,
            "candidate_name": candidate_name,
            "job_title": job.get("title", job.get("interview_field", "General Position")),
            "question": full_response,
            "total_questions": 5, # Can be dynamic later
            "current_question": 1
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start-demo")
async def start_demo_interview(
    job_title: str = Form(...),
    candidate_name: str = Form("Demo Candidate"),
    db=Depends(get_database)
):
    """Start a shortened demo interview without requiring CV or job posting id."""
    try:
        import asyncio
        
        session_id = str(uuid.uuid4())
        
        job_description = f"Dummy job description for {job_title}. This is a demonstration so keep questions general but relevant."
        required_skills = ["Communication", "Problem Solving", "Adaptability"]
        extra_instructions = "Keep the interview conversational and very short as this is a demo to show the platform's capabilities."
        
        # Create context for the demo session
        context = InterviewServiceContext(
            candidate_name=candidate_name,
            candidate_cv_json={"summary": "Demo candidate evaluating the platform."},
            job_description=job_description,
            required_skills=required_skills,
            recruiter_extra_instructions=extra_instructions,
            is_demo=True
        )
        
        # Get the interview service instance - it should be initialized in main.py
        try:
            # Import here to avoid circular imports at module load time
            import sys
            main_module = sys.modules.get('main')
            if main_module and hasattr(main_module, 'get_interview_service'):
                service = main_module.get_interview_service()
            else:
                # Fallback: create a new instance if not available
                from database.connection import db_manager
                service = InterviewService(db_manager.db)
        except Exception as e:
            print(f"Error getting interview service: {e}")
            raise HTTPException(status_code=500, detail="Failed to initialize interview service")
        
        try:
            # Initialize the session
            new_session_id = await service.initialize_session(context, "demo_job_id", "demo_candidate_id")
            
            # Get the first question
            full_response = ""
            try:
                async for chunk in service.process_input(new_session_id, "INIT"):
                    full_response += chunk
            except Exception as input_err:
                print(f"Initial AI response error: {input_err}")
            
            return {
                "success": True,
                "message": "Demo Interview sequence initiated",
                "session_id": new_session_id,
                "candidate_name": candidate_name,
                "job_title": job_title,
                "question": full_response if full_response else f"Hello {candidate_name}! Let's begin the interview for the {job_title} position.",
                "total_questions": 3,
                "current_question": 1
            }
        except Exception as service_error:
            print(f"Service initialization error: {service_error}")
            raise HTTPException(status_code=500, detail="Failed to initialize demo interview session. Make sure MongoDB is running locally.")
            
    except Exception as e:
        import traceback
        print(f"Demo interview error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="An error occurred while starting the demo interview. Please check server logs and ensure MongoDB is running.")


@router.post("/next-question")
async def next_question(
    session_id: str = Form(...),
    db=Depends(get_database)
):
    """Fallback if we want to explicitly advance the interview without an answer"""
    from main import get_interview_service
    service = get_interview_service()
    
    session_data = await service.get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found")
        
    session, context = session_data
        
    # Process empty or continue prompt
    full_response = ""
    async for chunk in service.process_input(session_id, "Please continue with the next question."):
        full_response += chunk
        
    return {
         "success": True,
         "complete": session.stage.value == "finished",
         "session_id": session_id,
         "question": full_response
    }


@router.post("/submit-answer")
async def submit_answer(
    session_id: str = Form(...),
    audio_file: Optional[UploadFile] = File(None),
    text_answer: Optional[str] = Form(None),
    db=Depends(get_database)
):
    from main import get_interview_service
    service = get_interview_service()
    
    session_data = await service.get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found")
        
    session, context = session_data
        
    answer_text = None
    
    if audio_file:
        content = await audio_file.read()
        try:
            answer_text = await service.transcribe_audio(content)
        except Exception as e:
            print(f"Transcription error: {e}")
            answer_text = text_answer or "I couldn't understand that."
            
    if not answer_text and text_answer:
         answer_text = text_answer
         
    if not answer_text:
        raise HTTPException(status_code=400, detail="No answer provided")
        
    # Process answer with LLM streaming back (we accumulate here for the REST response)
    full_response = ""
    async for chunk in service.process_input(session_id, answer_text):
        full_response += chunk
        
    # We maintain dummy feedback / score formats for compatibility with frontend,
    # or rely solely on conversational progression.
    is_complete = session.stage.value == "finished"
    
    return {
        "success": True,
        "feedback": "Processed.",
        "score": 0, # Could be evaluated in real-time or mocked
        "current_question": len([x for x in session.transcript if x["role"] == "interviewer"]),
        "total_questions": 5,
        "is_complete": is_complete,
        "next_question": full_response
    }


@router.post("/generate-report/{session_id}")
async def generate_report(session_id: str, db=Depends(get_database)):
    # This might already be done automatically in the service upon FINISHED state
    return {
        "success": True,
        "session_id": session_id,
        "report_path": "",
        "summary": {
            "eval_msg": "Evaluation saved directly to the database for recruiter view."
        }
    }


@router.get("/reports/{job_id}")
async def get_interview_reports(job_id: str, db=Depends(get_database)):
    """
    Get all interview sessions for a specific job, including candidate info and scores.
    """
    try:
        sessions = []
        cursor = db.interview_sessions.find({"job_id": job_id}).sort("created_at", -1)
        async for session in cursor:
            session_id = session.get("session_id")

            # Fetch candidate data from interview_cvs via candidate_id
            candidate_id = session.get("candidate_id")
            cv_doc = None
            if candidate_id:
                from bson import ObjectId
                try:
                    cv_doc = await db.interview_cvs.find_one({"_id": ObjectId(candidate_id)})
                except Exception:
                    cv_doc = await db.interview_cvs.find_one({"session_id": session_id})
            if not cv_doc:
                cv_doc = await db.interview_cvs.find_one({"session_id": session_id})

            candidate_name = (
                cv_doc.get("candidate_name") if cv_doc else None
            ) or session.get("context", {}).get("candidate_name", "Unknown Candidate")

            email_address = cv_doc.get("email_address", "") if cv_doc else ""
            phone_number = cv_doc.get("phone_number", "") if cv_doc else ""
            cv_file_path = cv_doc.get("cv_file_path") if cv_doc else None

            # Score / status
            raw_score = session.get("avg_score")
            status = session.get("status", "In Progress")
            if raw_score is not None:
                avg_score = raw_score
            else:
                avg_score = None

            # Fetch ranking_id for Evaluation view reports connection
            ranking_id = None
            if candidate_id:
                ranking_doc = await db.candidate_rankings.find_one({
                    "candidate_id": str(candidate_id),
                    "job_posting_id": job_id
                })
                if ranking_doc:
                    ranking_id = str(ranking_doc["_id"])

            sessions.append({
                "_id": str(session["_id"]),
                "session_id": session_id,
                "candidate_id": session.get("candidate_id", ""),
                "candidate_name": candidate_name,
                "email_address": email_address,
                "phone_number": phone_number,
                "date_applied": session.get("created_at", datetime.utcnow()).strftime("%d %b %Y"),
                "avg_score": avg_score,
                "status": status,
                "ranking_id": ranking_id,
                "has_cv": cv_file_path is not None and Path(cv_file_path).exists(),
            })

        return {"reports": sessions, "total": len(sessions)}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cv-file/{session_id}")
async def download_cv_file(session_id: str, db=Depends(get_database)):
    """
    Download the CV file for a given interview session.
    Resolves the correct interview_cvs record via interview_sessions.candidate_id.
    """
    cv_doc = None
    # First try resolving via interview_sessions.candidate_id
    sess_doc = await db.interview_sessions.find_one({"session_id": session_id})
    candidate_id = sess_doc.get("candidate_id") if sess_doc else None
    if candidate_id:
        from bson import ObjectId
        try:
            cv_doc = await db.interview_cvs.find_one({"_id": ObjectId(candidate_id)})
        except Exception:
            pass
    # Fallback: direct session_id lookup (legacy data)
    if not cv_doc:
        cv_doc = await db.interview_cvs.find_one({"session_id": session_id})

    if not cv_doc:
        raise HTTPException(status_code=404, detail="Candidate record not found")

    cv_file_path = cv_doc.get("cv_file_path")
    if not cv_file_path or not Path(cv_file_path).exists():
        raise HTTPException(status_code=404, detail="CV file not found on server")

    candidate_name = cv_doc.get("candidate_name", "candidate")
    safe_name = "".join(c for c in candidate_name if c.isalnum() or c in (" ", "_", "-")).strip()
    download_name = f"{safe_name}_CV.pdf"

    return FileResponse(
        path=cv_file_path,
        media_type="application/pdf",
        filename=download_name
    )
