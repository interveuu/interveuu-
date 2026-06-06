const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000/api";

// Direct backend URL for WebSocket connections (Vercel rewrites don't support WebSocket).
// In development this falls back to localhost; in production it must point to the Render service.
const getBackendUrl = () => {
    // 1. If explicitly set, use it (cleaned of trailing slash)
    if (process.env.REACT_APP_BACKEND_URL) {
        return process.env.REACT_APP_BACKEND_URL.replace(/\/+$/, "");
    }
    
    // 2. If API URL is absolute, extract origin from it
    if (API_BASE_URL && API_BASE_URL.startsWith("http")) {
        try {
            const parsed = new URL(API_BASE_URL);
            return parsed.origin;
        } catch (e) {
            // Ignore parsing error
        }
    }
    
    // 3. If running on production host but no URL configured, fallback to known Render production backend
    if (typeof window !== "undefined" && 
        window.location.hostname !== "localhost" && 
        window.location.hostname !== "127.0.0.1") {
        return "https://interveuu.onrender.com";
    }
    
    return "http://localhost:8000";
};

export const BACKEND_URL = getBackendUrl();

export default API_BASE_URL;
