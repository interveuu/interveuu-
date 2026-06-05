"""
Ranking and Evaluation API Routes
"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import io
import json
from database.connection import get_database
from database.ranking_crud import (
    get_rankings_by_job,
    get_rankings_by_recruiter,
    update_ranking_status,
    get_evaluations_by_job,
    get_evaluations_by_recruiter,
    get_evaluation_by_id
)

router = APIRouter(prefix="/rankings", tags=["Rankings & Evaluations"])


class UpdateStatusRequest(BaseModel):
    status: str


@router.get("/job/{job_id}", response_model=list)
async def get_job_rankings(
    job_id: str,
    db=Depends(get_database)
):
    """Get all candidate rankings for a specific job."""
    rankings = await get_rankings_by_job(db, job_id)
    
    # Sort rankings descending by score
    sorted_rankings = sorted(rankings, key=lambda x: x.get('score', 0), reverse=True)
    
    result = []
    for index, ranking in enumerate(sorted_rankings):
        result.append({
            "id": str(ranking["_id"]),  # Convert ObjectId to string
            "jobPostingId": ranking["job_posting_id"],
            "recruiterId": ranking["recruiter_id"],
            "candidateName": ranking["candidate_name"],
            "rank": index + 1, # Dynamic rank assignment
            "score": f"{ranking.get('score', 0):.0f}/100",
            "cvScore": f"{ranking.get('cv_score', 0):.0f}/100",
            "cvTechnicalScore": f"{ranking.get('cv_technical_score', 0):.0f}/100",
            "cvExperienceScore": f"{ranking.get('cv_experience_score', 0):.0f}/100",
            "cvProjectScore": f"{ranking.get('cv_project_score', 0):.0f}/100",
            "cvEducationScore": f"{ranking.get('cv_education_score', 0):.0f}/100",
            "interviewScore": f"{ranking.get('interview_score', 0):.0f}/100",
            "technicalScore": f"{ranking.get('technical_score', 0):.0f}/100",
            "communicationScore": f"{ranking.get('communication_score', 0):.0f}/100",
            "confidenceScore": f"{ranking.get('confidence_score', 0):.0f}/100",
            "facialRecognitionScore": f"{ranking.get('facial_recognition_score', 0):.0f}/100",
            "completion": f"{ranking.get('completion', 100)}%",
            "interviewStatus": ranking.get("interview_status", "Pending"),
            "date": ranking["created_at"].strftime("%d-%m-%Y"),
            "cvData": ranking.get("cv_data"),
            "evaluationDetails": ranking.get("evaluation_details")
        })
        
    return result


@router.get("/recruiter/{recruiter_id}", response_model=list)
async def get_recruiter_rankings(
    recruiter_id: str,
    db=Depends(get_database)
):
    """Get all candidate rankings by recruiter."""
    print(f"[DEBUG] Fetching rankings for recruiter_id: {recruiter_id}")
    rankings = await get_rankings_by_recruiter(db, recruiter_id)
    print(f"[DEBUG] Found {len(rankings)} rankings")
    # Sort the rankings descending
    sorted_rankings = sorted(rankings, key=lambda x: x.get('score', 0), reverse=True)
    
    result = []
    
    for index, ranking in enumerate(sorted_rankings):
        print(f"[DEBUG] Processing ranking: {ranking.get('_id')}, job_posting_id: {ranking.get('job_posting_id')}")
        
        # Safe score formatting
        try:
            score_val = ranking.get('score', 0)
            score_display = f"{float(score_val):.0f}/100"
        except (ValueError, TypeError):
            score_display = "N/A"
            
        result.append({
            "id": ranking["_id"],
            "jobPostingId": ranking["job_posting_id"],
            "recruiterId": ranking["recruiter_id"],
            "candidateName": ranking["candidate_name"],
            "rank": index + 1,
            "score": score_display,
            "completion": f"{ranking.get('completion', 100)}%",
            "interviewStatus": ranking.get("interview_status", "Unknown"),
            "date": ranking["created_at"].strftime("%d-%m-%Y")
        })
    
    print(f"[DEBUG] Returning {len(result)} formatted rankings")
    return result


@router.put("/{ranking_id}/status", response_model=dict)
async def update_candidate_status(
    ranking_id: str,
    status_data: UpdateStatusRequest,
    db=Depends(get_database)
):
    """Update candidate interview status."""
    success = await update_ranking_status(db, ranking_id, status_data.status)
    
    if not success:
        raise HTTPException(status_code=404, detail="Ranking not found")
    
    return {
        "success": True,
        "message": "Status updated successfully"
    }


@router.get("/{ranking_id}/report", response_model=dict)
async def get_candidate_report(
    ranking_id: str,
    db=Depends(get_database)
):
    """Get detailed candidate report."""
    from database.job_posting_crud import get_job_posting_by_id
    from bson import ObjectId
    
    # Get ranking
    ranking = await db.candidate_rankings.find_one({"_id": ObjectId(ranking_id)})
    if not ranking:
        raise HTTPException(status_code=404, detail="Ranking not found")
    
    # Get job posting for JD
    job = await get_job_posting_by_id(db, ranking["job_posting_id"])
    
    # Calculate actual rank dynamically
    from database.ranking_crud import get_rankings_by_job
    all_rankings = await get_rankings_by_job(db, ranking["job_posting_id"])
    sorted_rankings = sorted(all_rankings, key=lambda x: x.get('score', 0), reverse=True)
    actual_rank = ranking.get("rank", 999) # Fallback to stored rank
    for idx, r in enumerate(sorted_rankings):
        if str(r.get("_id")) == ranking_id:
            actual_rank = idx + 1
            break

    # Get evaluation report
    evaluation = await db.evaluation_reports.find_one({"candidate_ranking_id": ranking_id})
    
    # Get session_id to link cv properly
    session_id = None
    email = None
    phone = None
    linkedin = None
    
    candidate_id = ranking.get("candidate_id")
    if candidate_id:
        session_doc = await db.interview_sessions.find_one({"candidate_id": str(candidate_id)})
        if session_doc:
            session_id = session_doc.get("session_id")
            
        from bson import ObjectId
        # Fetch the CV doc to get the details entered before the interview
        cv_data_doc = await db.interview_cvs.find_one({"_id": ObjectId(str(candidate_id))})
        if cv_data_doc:
            email = cv_data_doc.get("email_address")
            phone = cv_data_doc.get("phone_number")
            linkedin = cv_data_doc.get("linkedin_profile")
            
    # Extract strengths and weaknesses from evaluation details
    eval_details = ranking.get("evaluation_details", {})
    strengths = []
    weaknesses = []
    
    # Parse evaluation details for strengths/weaknesses replacing old eval_details
    if evaluation:
        if "strengths" in evaluation:
            strengths = evaluation["strengths"] if isinstance(evaluation["strengths"], list) else [evaluation["strengths"]]
        if "weaknesses" in evaluation:
            weaknesses = evaluation["weaknesses"] if isinstance(evaluation["weaknesses"], list) else [evaluation["weaknesses"]]
        
    # Fallback to old format if not in new format
    if not strengths and isinstance(eval_details, dict):
        strengths = eval_details.get("strengths", [])
        if not isinstance(strengths, list): strengths = [strengths]
    if not weaknesses and isinstance(eval_details, dict):
        weaknesses = eval_details.get("weaknesses", [])
        if not isinstance(weaknesses, list): weaknesses = [weaknesses]
        
    # Final fallback: generate based on scores
    if not strengths:
        strengths = [
            "No specific strengths recorded"
        ]
    if not weaknesses:
        weaknesses = [
            "No specific areas of improvement recorded"
        ]
    
    # Build skills array
    skills = []
    if evaluation:
        for skill_name, skill_score in evaluation.get("skill_scores", {}).items():
            skills.append({
                "name": skill_name,
                "percentage": int(skill_score),
                "color": _get_skill_color(skill_name)
            })
            
    # Fetch visual analytics
    visual_analytics = None
    if session_id:
        visual_data = await db.candidate_visual_analysis.find_one({"interview_id": session_id})
        if visual_data:
            # Convert ObjectId and datetime to string to avoid JSON serialization issues
            visual_data["_id"] = str(visual_data["_id"])
            if "created_at" in visual_data:
                visual_data["created_at"] = visual_data["created_at"].isoformat()
            visual_analytics = visual_data
    
    return {
        "candidateName": ranking["candidate_name"],
        "position": job.get("interview_field", "") + " - " + job.get("position_level", ""),
        "score": f"{ranking['score']:.0f}/100",
        "cvScore": f"{ranking.get('cv_score', 0):.0f}/100",
        "interviewScore": f"{ranking.get('interview_score', 0):.0f}/100",
        "facialRecognitionScore": f"{ranking.get('facial_recognition_score', 0):.0f}/100",
        "rank": actual_rank,
        "completion": f"{ranking.get('completion', 100)}%",
        "interviewStatus": ranking["interview_status"],
        "date": ranking["created_at"].strftime("%d-%m-%Y"),
        "skills": skills,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "cvSummary": ranking.get("cv_data", {}).get("text", "CV summary not available"),
        "jobDescription": job.get("job_description", "No job description provided"),
        "detailedAnalysis": evaluation.get("summary") or evaluation.get("detailed_analysis") if evaluation else None,
        "recommendations": evaluation.get("verdict") or evaluation.get("recommendations") if evaluation else None,
        "evaluationId": str(evaluation["_id"]) if evaluation else None,
        "sessionId": session_id,
        "manualEndDetected": ranking.get("manual_end_detected", False) or ranking.get("interview_status") == "Manually Ended",
        "email": email,
        "phone": phone,
        "linkedin": linkedin,
        "visualAnalytics": visual_analytics
    }


# ==================== Evaluation Reports ====================

@router.get("/evaluations/job/{job_id}", response_model=list)
async def get_job_evaluations(
    job_id: str,
    db=Depends(get_database)
):
    """Get all evaluation reports for a specific job."""
    evaluations = await get_evaluations_by_job(db, job_id)
    return [
        {
            "id": evaluation["_id"],
            "jobPostingId": evaluation["job_posting_id"],
            "candidateName": evaluation["candidate_name"],
            "position": evaluation["position"],
            "score": f"{evaluation['overall_score']:.0f}%",
            "skills": [
                {
                    "name": skill_name,
                    "percentage": int(skill_score),
                    "color": _get_skill_color(skill_name)
                }
                for skill_name, skill_score in evaluation["skill_scores"].items()
            ]
        }
        for evaluation in evaluations
    ]


@router.get("/evaluations/recruiter/{recruiter_id}", response_model=list)
async def get_recruiter_evaluations(
    recruiter_id: str,
    db=Depends(get_database)
):
    """Get all evaluation reports by recruiter."""
    from bson import ObjectId
    
    evaluations = await get_evaluations_by_recruiter(db, recruiter_id)
    
    result = []
    for evaluation in evaluations:
        # Get ranking to find ranking_id
        ranking = await db.candidate_rankings.find_one({"_id": ObjectId(evaluation["candidate_ranking_id"])})
        
        skills = []
        for skill_name, skill_score in evaluation.get("skill_scores", {}).items():
            skills.append({
                "name": skill_name,
                "percentage": int(skill_score)
            })
        
        result.append({
            "id": str(evaluation["_id"]),  # Evaluation ID for download
            "rankingId": str(ranking["_id"]) if ranking else None,  # Ranking ID for view report
            "jobPostingId": evaluation["job_posting_id"],
            "recruiterId": evaluation["recruiter_id"],
            "candidateName": evaluation["candidate_name"],
            "position": evaluation["position"],
            "score": f"{evaluation['overall_score']:.0f}%",
            "skills": skills
        })
    
    return result


@router.get("/evaluations/{evaluation_id}/download")
async def download_evaluation_report(
    evaluation_id: str,
    db=Depends(get_database)
):
    """Download evaluation report as professional PDF."""
    from services.pdf_generator import create_evaluation_pdf
    from database.job_posting_crud import get_job_posting_by_id
    from bson import ObjectId
    
    # Get evaluation report
    evaluation = await db.evaluation_reports.find_one({"_id": ObjectId(evaluation_id)})
    
    if not evaluation:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    
    # Get ranking for additional details
    ranking = await db.candidate_rankings.find_one({"_id": ObjectId(evaluation["candidate_ranking_id"])})
    
    # Get job posting for company info
    job = await get_job_posting_by_id(db, evaluation["job_posting_id"])
    
    # Get recruiter info for company name
    recruiter = await db.recruiters.find_one({"_id": ObjectId(evaluation["recruiter_id"])})
    company_name = recruiter.get("company", "Your Company") if recruiter else "Your Company"
    
    # Extract strengths and weaknesses
    eval_details = ranking.get("evaluation_details", {}) if ranking else {}
    strengths = []
    weaknesses = []
    
    if isinstance(eval_details, dict):
        if "strengths" in eval_details:
            strengths = eval_details["strengths"] if isinstance(eval_details["strengths"], list) else [eval_details["strengths"]]
        if "weaknesses" in eval_details:
            weaknesses = eval_details["weaknesses"] if isinstance(eval_details["weaknesses"], list) else [eval_details["weaknesses"]]
        
        # Fallback
        if not strengths:
            strengths = [
                "Strong technical background and relevant experience",
                "Excellent communication and interpersonal skills",
                "Demonstrates problem-solving abilities"
            ]
        if not weaknesses:
            weaknesses = [
                "Could benefit from additional training in specific technologies",
                "Limited experience with some advanced tools"
            ]
    
    # Build skills array
    skills = []
    for skill_name, skill_score in evaluation.get("skill_scores", {}).items():
        skills.append({
            "name": skill_name,
            "percentage": int(skill_score)
        })
    
    # Prepare data for PDF
    pdf_data = {
        "candidateName": evaluation["candidate_name"],
        "position": evaluation["position"],
        "score": f"{evaluation['overall_score']:.0f}/100",
        "cvScore": f"{ranking.get('cv_score', 0):.0f}/100",
        "interviewScore": f"{ranking.get('interview_score', 0):.0f}/100",
        "facialRecognitionScore": f"{ranking.get('facial_recognition_score', 0):.0f}/100",
        "rank": ranking["rank"] if ranking else "N/A",
        "interviewStatus": ranking["interview_status"] if ranking else "N/A",
        "date": evaluation["created_at"].strftime("%d-%m-%Y"),
        "completion": f"{ranking['completion']}%" if ranking else "100%",
        "skills": skills,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "recommendations": evaluation.get("recommendations", "Candidate shows strong potential for the role.")
    }
    
    # Generate PDF
    pdf_buffer = create_evaluation_pdf(pdf_data, company_name)
    
    # Return as streaming response
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={evaluation['candidate_name'].replace(' ', '_')}_Evaluation_Report.pdf"
        }
    )


def _get_skill_color(skill_name: str) -> str:
    """Get color for skill based on name."""
    color_map = {
        "Technical Skills": "bg-blue-500",
        "Communication": "bg-green-500",
        "Problem Solving": "bg-pink-500",
        "Experience": "bg-purple-500",
        "Leadership": "bg-orange-500"
    }
    return color_map.get(skill_name, "bg-gray-500")
