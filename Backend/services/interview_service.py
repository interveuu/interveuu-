from typing import Dict, Optional, AsyncGenerator, List
import uuid
import json
import base64
from datetime import datetime
from pydantic import BaseModel
from enum import Enum

from agents.interview_agent.models import InterviewStage, Question, InterviewState
from agents.interview_agent.prompts import INTERVIEWER_SYSTEM_PROMPT, STAGE_INSTRUCTIONS

# Import LLM/STT/TTS services directly
# We will create wrappers around existing services or copy them to Backend/services
from services.llm_service import LLMService 
from services.stt_service import STTService
from services.tts_service import TTSService


class InterviewServiceContext:
    def __init__(self, candidate_name: str, candidate_cv_json: dict, job_description: str, required_skills: list, recruiter_extra_instructions: str, is_demo: bool = False):
        self.candidate_name = candidate_name
        self.candidate_cv_json = candidate_cv_json
        self.job_description = job_description
        self.required_skills = required_skills
        self.recruiter_extra_instructions = recruiter_extra_instructions
        self.is_demo = is_demo


class InterviewService:
    def __init__(self, db):
        self.db = db
        self.llm_service = LLMService()
        self.stt_service = STTService()
        self.tts_service = TTSService()

    async def initialize_session(self, context: InterviewServiceContext, job_id: str, candidate_id: str) -> str:
        session_id = str(uuid.uuid4())
        
        session_state = InterviewState(
            candidate_name=context.candidate_name,
            job_role="Candidate", # Will use JD instead
            stage=InterviewStage.INTRODUCTION
        )
        
        # 3. Create Session in DB with context and state
        await self.db.interview_sessions.insert_one({
            "session_id": session_id,
            "job_id": job_id,
            "candidate_id": candidate_id,
            "transcript": [],
            "technical_score": 0,
            "behavioral_score": 0,
            "confidence_score": 0,
            "overall_score": 0,
            "status": "In Progress",
            "created_at": datetime.utcnow(),
            "context": {
                "candidate_name": context.candidate_name,
                "candidate_cv_json": context.candidate_cv_json,
                "job_description": context.job_description,
                "required_skills": context.required_skills,
                "recruiter_extra_instructions": context.recruiter_extra_instructions,
                "is_demo": context.is_demo
            },
            "state_overrides": {
                "stage": session_state.stage.value,
                "current_difficulty": session_state.current_difficulty,
                "skills_covered": session_state.skills_covered
            }
        })
        
        return session_id

    async def get_session(self, session_id: str) -> Optional[tuple[InterviewState, InterviewServiceContext]]:
        doc = await self.db.interview_sessions.find_one({"session_id": session_id})
        if not doc:
            return None
            
        context_data = doc.get("context", {})
        state_overrides = doc.get("state_overrides", {})
        transcript = doc.get("transcript", [])
        
        context = InterviewServiceContext(
            candidate_name=context_data.get("candidate_name", "Unknown"),
            candidate_cv_json=context_data.get("candidate_cv_json", {}),
            job_description=context_data.get("job_description", ""),
            required_skills=context_data.get("required_skills", []),
            recruiter_extra_instructions=context_data.get("recruiter_extra_instructions", ""),
            is_demo=context_data.get("is_demo", False)
        )
        
        session = InterviewState(
            candidate_name=context.candidate_name,
            job_role="Candidate",
            stage=InterviewStage(state_overrides.get("stage", "introduction")),
            transcript=transcript,
            skills_covered=state_overrides.get("skills_covered", []),
            current_difficulty=state_overrides.get("current_difficulty", "medium")
        )
        
        return session, context

    async def process_input(self, session_id: str, user_input: str) -> AsyncGenerator[str, None]:
        session_data = await self.get_session(session_id)
        
        if not session_data:
            yield "Error: Session not found."
            return
            
        session, context = session_data

        # 1. Update Transcript with User Input
        if user_input.strip() != "INIT":
            session.transcript.append({"role": "candidate", "content": user_input})
            
            # Save to DB asynchronously (fire and forget or await)
            await self.db.interview_sessions.update_one(
                {"session_id": session_id},
                {"$push": {"transcript": {"role": "candidate", "content": user_input, "timestamp": datetime.utcnow()}}}
            )

            # Fire off background evaluation for the previous question and current answer
            import asyncio
            
            # Get the last AI question
            last_question = ""
            for msg in reversed(session.transcript[:-1]):
                if msg["role"] == "interviewer":
                    last_question = msg["content"]
                    break
                    
            if last_question:
                async def evaluate_and_store(q: str, a: str, s_id: str):
                    try:
                        eval_scores = await self.llm_service.evaluate_answer_groq(q, a)
                        await self.db.interview_sessions.update_one(
                            {"session_id": s_id},
                            {"$push": {"answer_evaluations": {
                                "question": q,
                                "answer": a,
                                "scores": eval_scores,
                                "timestamp": datetime.utcnow()
                            }}}
                        )
                    except Exception as e:
                        print(f"Error in background evaluation: {e}")
                
                asyncio.create_task(evaluate_and_store(last_question, user_input, session_id))
        
        # 2. Determine Stage & Instructions
        current_stage = session.stage
        interaction_count = len([x for x in session.transcript if x["role"] == "interviewer"])

        # Simple Stage Transition Logic
        is_demo = getattr(context, "is_demo", False)
        
        target_core_start = 1 if is_demo else 2
        target_wrapup_start = 3 if is_demo else 7

        if current_stage == InterviewStage.INTRODUCTION and interaction_count > 0:
            session.stage = InterviewStage.WARMUP
        elif current_stage == InterviewStage.WARMUP and interaction_count > target_core_start:
            session.stage = InterviewStage.CORE
        elif current_stage == InterviewStage.CORE and interaction_count > target_wrapup_start:
            session.stage = InterviewStage.WRAPUP

        stage_instructions = STAGE_INSTRUCTIONS.get(session.stage.value, "")

        # 3. Construct History
        history = []
        
        # Define context-dependent string replacements
        extra_instr = context.recruiter_extra_instructions
        cv_json_val = json.dumps(context.candidate_cv_json, indent=2)
        if is_demo:
            cv_json_val = "Note: This is a demo interview. The user has not provided a CV. Do NOT ask about projects from the CV."
            extra_instr += " IMPORTANT: DO NOT attempt to ask about any CV projects. Keep questions general."

        # Add System Prompt with the new context
        system_prompt = INTERVIEWER_SYSTEM_PROMPT.format(
            job_description=context.job_description,
            required_skills=", ".join(context.required_skills) if context.required_skills else "Not specified",
            extra_instructions=extra_instr,
            candidate_name=context.candidate_name,
            candidate_cv_json=cv_json_val,
            stage=session.stage.value,
            stage_instructions=stage_instructions
        )
        history.append({"role": "system", "content": system_prompt})

        # Add Chat History
        for msg in session.transcript[-10:]:
             role = "user" if msg["role"] == "candidate" else "assistant"
             history.append({"role": role, "content": msg["content"]})

        # 4. Generate AI Response
        ai_response_chunks = []
        # If user_input was INIT, request the AI to initiate the intro instead of simulating candidate readiness.
        prompt_input = "Please initiate the interview. Welcome me and follow your introduction instructions." if user_input == "INIT" else user_input
        
        try:
            async for chunk in self.llm_service.generate_response(prompt_input, history=history):
                ai_response_chunks.append(chunk)
                yield chunk
        except Exception as e:
            # We catch exceptions to gracefully handle cancellations
            pass

        finally:
            full_response = "".join(ai_response_chunks)
            if full_response.strip():
                # 5. Update Transcript with AI Response
                session.transcript.append({"role": "interviewer", "content": full_response})
                
                # Determine if finished based on LLM output
                response_lower = full_response.lower()
                if any(phrase in response_lower for phrase in [
                    "interview is now concluded", 
                    "thank you for your time", 
                    "interview is concluded",
                    "concluding the interview",
                    "ending the interview",
                    "interview concluded"
                ]):
                    session.stage = InterviewStage.FINISHED
                    
                import asyncio
                
                async def safe_db_update(sid, resp, stage_val):
                    try:
                        await self.db.interview_sessions.update_one(
                            {"session_id": sid},
                            {
                                "$push": {"transcript": {"role": "interviewer", "content": resp, "timestamp": datetime.utcnow()}},
                                "$set": {
                                    "state_overrides.stage": stage_val
                                }
                            },
                            upsert=False
                        )
                    except Exception as e:
                        print(f"Error in safe DB update: {e}")

                # Using create_task to ensure DB update survives task cancellation
                asyncio.create_task(safe_db_update(session_id, full_response, session.stage.value))

    async def transcribe_audio(self, audio_bytes: bytes) -> str:
        return await self.stt_service.transcribe(audio_bytes)
        
    async def generate_speech(self, text: str) -> Optional[bytes]:
        return await self.tts_service.generate_speech(text)

    async def finalize_interview(self, session_id: str):
        """
        Evaluate transcript and generate final report
        """
        session_data = await self.get_session(session_id)
        if not session_data:
            return
        session, context = session_data
        
        # Prevent double finalization
        session_doc = await self.db.interview_sessions.find_one({"session_id": session_id})
        status = session_doc.get("status", "In Progress")
        if status == "Completed":
            return {"score": session_doc.get("avg_score", 0), "summary": "Already evaluated.", "status": status}

        # 1. Calculate Scores from Evaluations
        evaluations = session_doc.get("answer_evaluations", [])
        
        tech_acc_sum = 0
        depth_sum = 0
        clarity_sum = 0
        conf_sum = 0
        
        total_evals = len(evaluations)
        
        if total_evals > 0:
            for ev in evaluations:
                scores = ev.get("scores", {})
                tech_acc_sum += scores.get("technical_accuracy", 0)
                depth_sum += scores.get("depth_of_explanation", 0)
                clarity_sum += scores.get("clarity", 0)
                conf_sum += scores.get("confidence_level", 0)
                
            # Averages (Scale 0-10)
            avg_tech = tech_acc_sum / total_evals
            avg_depth = depth_sum / total_evals
            avg_clarity = clarity_sum / total_evals
            avg_conf = conf_sum / total_evals
            
            # Scale to 100
            # Technical score comes from TWO 0-10 variables, so max is 20. Multiple by 5 to get to 100.
            technical_score = (avg_tech + avg_depth) * 5
            
            # Communication and Confidence are single 0-10 variables. Multiply by 10 to get to 100.
            communication_score = avg_clarity * 10
            confidence_score = avg_conf * 10
        else:
            technical_score = 0
            communication_score = 0
            confidence_score = 0
            
        # Base interview score calculation
        interview_score = (technical_score * 0.5) + (communication_score * 0.3) + (confidence_score * 0.2)
        
        # 2. Penalty Logic
        status = session_doc.get("status", "Completed")
        if status == "Manually Ended":
            interview_score -= 15
            
        # Target questions is roughly 5-7 based on the flow. If they answered less than 3, penalized.
        if total_evals < 3:
            interview_score -= 10
            
        interview_score = max(0, min(100, interview_score))
        
        # 3. Retrieve Candidate Rankings & CV Score
        candidate_id = session_doc.get("candidate_id")
        ranking_doc = await self.db.candidate_rankings.find_one({
            "candidate_id": candidate_id,
            "job_posting_id": session_doc.get("job_id")
        })
        
        cv_score = ranking_doc.get("cv_score", 0) if ranking_doc else 0
        cv_technical_score = ranking_doc.get("cv_technical_score", 0) if ranking_doc else 0
        cv_experience_score = ranking_doc.get("cv_experience_score", 0) if ranking_doc else 0
        cv_project_score = ranking_doc.get("cv_project_score", 0) if ranking_doc else 0
        cv_education_score = ranking_doc.get("cv_education_score", 0) if ranking_doc else 0
        
        # Final combined math
        final_score = round((cv_score * 0.3) + (interview_score * 0.7))
        
        # 4. Generate Feedback using Gemini (NOT GROQ here)
        from agents.interview_agent.prompts import FINAL_FEEDBACK_REPORT_PROMPT
        from cv_screener.gemini_screener import GeminiCVScreener
        
        feedback_prompt = FINAL_FEEDBACK_REPORT_PROMPT.format(
            cv_score=cv_score,
            technical_score=technical_score,
            communication_score=communication_score,
            confidence_score=confidence_score,
            final_score=final_score,
            status=status
        )
        
        screener = GeminiCVScreener()
        # Using a raw call because the prompt is direct text 
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            res = await loop.run_in_executor(
                None,
                lambda: screener.client.models.generate_content(
                    model=screener.MODEL_NAME,
                    contents=feedback_prompt
                )
            )
            feedback_report = res.text.strip()
        except Exception as e:
            print(f"Error generating feedback report: {e}")
            feedback_report = "System encountered an error generating the detailed feedback report."

        # Update Session with final scores
        evaluation = {
            "avg_score": final_score,
            "technical_score": technical_score,
            "communication_score": communication_score,
            "confidence_score": confidence_score,
            "interview_score": interview_score,
            "status": "Completed" if status != "Manually Ended" else status,
            "completed_at": datetime.utcnow()
        }
        
        await self.db.interview_sessions.update_one(
            {"session_id": session_id},
            {"$set": evaluation}
        )
            
        # Data is stored at the top level by create_interview_cv
        job_id = session_doc.get("job_id")
        
        # Fetch Job to get Recruiter ID
        from bson import ObjectId
        from bson.errors import InvalidId
        job = None
        if job_id:
            try:
                job = await self.db.job_postings.find_one({"_id": ObjectId(job_id)})
            except InvalidId:
                job = None
                
        recruiter_id = job.get("recruiter_id") if job else "Unknown Recruiter"
        position = job.get("interview_field", "General Position") if job else "General Position"
        candidate_name = session.candidate_name
        
        # 5. Update Candidate Ranking for Dashboard
        if ranking_doc:
            await self.db.candidate_rankings.update_one(
                {"_id": ranking_doc["_id"]},
                {"$set": {
                    "score": final_score,
                    "interview_score": interview_score,
                    "technical_score": technical_score,
                    "communication_score": communication_score,
                    "confidence_score": confidence_score,
                    "completion": 100,
                    "interview_status": "Completed" if status != "Manually Ended" else status,
                    "evaluation_details.interview_summary": feedback_report
                }}
            )
            ranking_id_str = str(ranking_doc["_id"])
        else:
            ranking_id_str = "Legacy_Ranking"
        
        # 6. Create Detailed Evaluation Report for recruiter PDF download and View
        from database.ranking_crud import create_evaluation_report
        await create_evaluation_report(
            self.db,
            job_posting_id=job_id,
            recruiter_id=recruiter_id,
            candidate_ranking_id=ranking_id_str,
            candidate_name=candidate_name,
            position=position,
            overall_score=final_score,
            skill_scores={
                "Interview Technical": technical_score,
                "Interview Communication": communication_score,
                "Interview Confidence": confidence_score,
                "CV Score": cv_score
            },
            detailed_analysis=feedback_report,
            recommendations="Ensure to review candidate's actual answers in the transcript if needed."
        )

        return {
            "score": final_score,
            "summary": feedback_report,
            "skills": [
                {"name": "Technical Knowledge", "score": int(technical_score)},
                {"name": "Communication", "score": int(communication_score)},
                {"name": "Confidence", "score": int(confidence_score)},
                {"name": "CV Initial Score", "score": int(cv_score)}
            ],
            "strengths": ["Data-driven metrics calculated", "AI Feedback generated"],
            "weaknesses": ["Note: specific examples should be reviewed in the transcript."],
            "verdict": "Completed"
        }

