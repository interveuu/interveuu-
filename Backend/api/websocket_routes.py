from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
import json
import asyncio
from typing import Dict
import uuid
import re

from database.connection import get_database
from services.interview_service import InterviewService

router = APIRouter(prefix="/ws", tags=["Interview WebSockets"])

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        self.active_connections[session_id] = websocket

    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]

    async def send_json(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_json(message)

manager = ConnectionManager()

async def tts_worker(session_id: str, queue: asyncio.Queue, tts_service, web_manager: ConnectionManager):
    import base64
    try:
        while True:
            text = await queue.get()
            if text is None:  # Sentinel
                queue.task_done()
                break
                
            try:
                tts_bytes = await tts_service.generate_speech(text)
                if tts_bytes:
                    b64 = base64.b64encode(tts_bytes).decode('utf-8')
                    await web_manager.send_json(session_id, {
                        "type": "audio_output",
                        "payload": b64,
                        "text": text
                    })
            except asyncio.CancelledError:
                queue.task_done()
                break
            except Exception as e:
                print(f"TTS Worker Error: {e}")
            finally:
                queue.task_done()
    except asyncio.CancelledError:
        pass

async def process_llm_and_tts(session_id: str, input_text: str, service: InterviewService, web_manager: ConnectionManager):
    queue = asyncio.Queue()
    worker_task = asyncio.create_task(tts_worker(session_id, queue, service.tts_service, web_manager))
    
    buffer = ""
    try:
        async for chunk in service.process_input(session_id, input_text):
            await web_manager.send_json(session_id, {"type": "text_chunk", "payload": chunk})
            buffer += chunk
            
            # Extract sentences safely (. ? ! optionally with quotes/spaces)
            match = re.search(r'(.*?[\.\!\?]+)(?:\s+|$)', buffer)
            while match:
                sentence = match.group(1).strip()
                buffer = buffer[match.end():]
                if len(sentence) > 3:
                    queue.put_nowait(sentence)
                match = re.search(r'(.*?[\.\!\?]+)(?:\s+|$)', buffer)
                
        if buffer.strip():
            queue.put_nowait(buffer.strip())
            
    except asyncio.CancelledError:
        worker_task.cancel()
        raise
    finally:
        queue.put_nowait(None)
        
    await queue.join()
    
    # Notify Frontend that the AI is fully done generating this response
    await web_manager.send_json(session_id, {
        "type": "response_complete",
        "payload": "done"
    })
    
    # Check if finished
    session_data = await service.get_session(session_id)
    if session_data:
        session, _ = session_data
        if session.stage.value == "finished":
            await web_manager.send_json(session_id, {
                "type": "interview_concluding",
                "payload": "Calculating results..."
            })
            report_dict = await service.finalize_interview(session_id)
            await web_manager.send_json(session_id, {
                "type": "report",
                "payload": report_dict
            })

@router.websocket("/interview/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await manager.connect(websocket, session_id)
    
    from main import get_interview_service
    service = get_interview_service()
    
    current_generation_task = None
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:
                message = json.loads(data)
                msg_type = message.get("type")
                payload = message.get("payload")
                
                if msg_type in ["audio_data", "text_data", "start_interview"]:
                    transcription = ""
                    
                    if msg_type == "audio_data":
                        import base64
                        audio_bytes = base64.b64decode(payload)
                        transcription = await service.transcribe_audio(audio_bytes)
                    elif msg_type == "text_data":
                        transcription = payload
                    elif msg_type == "start_interview":
                        transcription = "INIT"
                        await manager.send_json(session_id, {
                            "type": "session_created",
                            "payload": "Session connected securely."
                        })

                    if transcription and transcription.strip():
                        if msg_type != "start_interview":
                            await manager.send_json(session_id, {
                                "type": "transcription",
                                "payload": transcription
                            })
                            
                        # Cancel existing running task to seamlessly interrupt LLM & TTS
                        if current_generation_task and not current_generation_task.done():
                            current_generation_task.cancel()
                            
                        # Start new async generation task safely without blocking ws listener
                        current_generation_task = asyncio.create_task(
                            process_llm_and_tts(session_id, transcription, service, manager)
                        )
                        
                elif msg_type == "interrupt":
                    # Fast-kill the LLM generation immediately
                    if current_generation_task and not current_generation_task.done():
                        current_generation_task.cancel()
                        
            except json.JSONDecodeError:
                pass
                
    except WebSocketDisconnect:
        manager.disconnect(session_id)
        if current_generation_task and not current_generation_task.done():
            current_generation_task.cancel()
        # Ensure interview is finalized on disconnect if not already done
        asyncio.create_task(service.finalize_interview(session_id))
    except Exception as e:
        import traceback
        traceback.print_exc()
        manager.disconnect(session_id)
        if current_generation_task and not current_generation_task.done():
            current_generation_task.cancel()
        asyncio.create_task(service.finalize_interview(session_id))
