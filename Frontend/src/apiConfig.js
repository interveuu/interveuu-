const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000/api";

// Direct backend URL for WebSocket connections (Vercel rewrites don't support WebSocket).
// In development this falls back to localhost; in production it must point to the Render service.
export const BACKEND_URL =
    process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";

export default API_BASE_URL;
