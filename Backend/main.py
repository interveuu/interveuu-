"""
CV Screener Backend - Main Application
Uses Gemini 2.5 Flash for CV screening against Job Descriptions
Integrated with MongoDB for data persistence
"""

import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from api.routes import router as api_router
from database.connection import db_manager

# Load environment variables
load_dotenv()

# Create upload directories
UPLOAD_DIRS = [
    Path("uploads/interview_cvs"),
    Path("uploads/screening_cvs")
]
for upload_dir in UPLOAD_DIRS:
    upload_dir.mkdir(parents=True, exist_ok=True)
    print(f"Upload directory ready: {upload_dir}")

# Create FastAPI app
app = FastAPI(
    title="Interveuu CV Screener API",
    description="API for screening CVs against Job Descriptions using Gemini 2.5 Flash and MongoDB",
    version="2.0.0"
)

# Configure CORS
origins = os.getenv(
    "ALLOWED_ORIGINS", 
    "http://localhost:3000,http://127.0.0.1:3000,https://interveuu.vercel.app,https://interveuu.onrender.com"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https://.*\.vercel\.app|http://localhost:\d+|http://127\.0\.0\.1:\d+",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Include API routes
app.include_router(api_router, prefix="/api")

# Include WebSocket routes
from api.websocket_routes import router as ws_router
app.include_router(ws_router)

# Include Superuser routes
from api.superuser_routes import router as superuser_router
app.include_router(superuser_router, prefix="/api")

# Include Superuser WebSocket routes
from api.superuser_ws import router as superuser_ws_router
app.include_router(superuser_ws_router)

@app.on_event("startup")
async def startup_event():
    """Initialize database connection on startup."""
    strict_startup = os.getenv("MONGODB_STRICT_STARTUP", "true").lower() in {
        "1",
        "true",
        "yes",
        "y",
        "on",
    }
    try:
        await db_manager.connect()
        
        # Seed default superuser account
        try:
            from database.init_superuser import init_superuser
            await init_superuser(db_manager.db)
        except Exception as e:
            print(f"Superuser initialization failed: {e}")

        # Auto-close expired job postings
        try:
            from database.job_posting_crud import close_expired_jobs
            closed = await close_expired_jobs(db_manager.db)
            if closed > 0:
                print(f"Auto-closed {closed} expired job posting(s)")
        except Exception as e:
            print(f"Expired jobs check failed: {e}")
    except Exception as e:
        print(f"MongoDB connection failed: {e}")
        if strict_startup:
            print("MONGODB_STRICT_STARTUP=true, shutting down...")
            raise
        # Allow app to boot so /health can report the failure.
        print("- Continuing without MongoDB (MONGODB_STRICT_STARTUP=false)")
        print("  → Authentication and database features will be unavailable")
        print("  → To fix: Start MongoDB or update MONGODB_URL in .env")


@app.on_event("shutdown")
async def shutdown_event():
    """Close database connection on shutdown."""
    await db_manager.disconnect()

# Singleton service for interview orchestration
from services.interview_service import InterviewService
_interview_service = None

def get_interview_service() -> InterviewService:
    global _interview_service
    if _interview_service is None:
        _interview_service = InterviewService(db_manager.db)
    return _interview_service

@app.get("/")
async def root():
    return {
        "message": "Interveuu CV Screener API",
        "version": "2.0.0",
        "status": "running",
        "database": "MongoDB"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    try:
        # Check database connection
        if db_manager.client is None:
            db_status = "disconnected"
        else:
            await db_manager.client.admin.command('ping')
            db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)[:50]}"
        db_status = "disconnected"
    
    return {
        "status": "healthy",
        "database": db_status
    }


if __name__ == "__main__":
    import uvicorn
    
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    
    uvicorn.run("main:app", host=host, port=port, reload=True)
