import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import PreInterviewModal from './PreInterviewModal';

const SecureInterviewWrapper = ({ sessionId, candidateId, onTerminate, onStart, children }) => {
    const [isInterviewActive, setIsInterviewActive] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [violationCount, setViolationCount] = useState(0);
    const [showWarning, setShowWarning] = useState(false);

    const MAX_VIOLATIONS = 3;
    const containerRef = useRef(null);
    const navigate = useNavigate();

    const reportViolationToBackend = useCallback(async (reason) => {
        // In a real scenario, this would post to a FastAPI endpoint
        console.warn("Security Violation:", reason);
    }, []);

    const handleViolation = useCallback((reason) => {
        setViolationCount((prevCount) => {
            const newCount = prevCount + 1;

            if (newCount >= MAX_VIOLATIONS) {
                reportViolationToBackend(`Terminated: ${reason}`);
                setIsInterviewActive(false);
                if (document.fullscreenElement) {
                    document.exitFullscreen().catch(console.error);
                }
                if (onTerminate) onTerminate('Session terminated due to multiple security violations.');
            } else {
                reportViolationToBackend(`Warning: ${reason}`);
                setShowWarning(true);
            }
            return newCount;
        });
    }, [reportViolationToBackend, onTerminate]);

    const enforceFullscreen = useCallback(() => {
        if (containerRef.current && !document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch((err) => {
                console.warn('Could not re-enter fullscreen:', err);
            });
        }
    }, []);

    const startInterview = async () => {
        setIsStarting(true);
        try {
            // First, pre-request camera and microphone to prevent permission popups from triggering security violations later
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            // Stop the tracks immediately so we don't hold them unnecessarily. The child components will legitimately re-request them (which will now auto-approve).
            stream.getTracks().forEach(track => track.stop());

            if (containerRef.current) {
                await containerRef.current.requestFullscreen();
                setIsInterviewActive(true);
                setViolationCount(0);
                setShowWarning(false);
                if (onStart) onStart();
            }
        } catch (err) {
            console.error("Failed to start interview:", err);
            alert('Camera, Microphone, and Fullscreen permissions are strictly required to start the interview. Please allow them in your browser settings.');
        } finally {
            setIsStarting(false);
        }
    };

    useEffect(() => {
        if (!isInterviewActive) return;

        const handleFullscreenChange = () => {
            if (!document.fullscreenElement) {
                handleViolation('Exited fullscreen');
                enforceFullscreen();
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                handleViolation('Switched tabs or minimized window');
            }
        };

        const handleWindowBlur = () => {
            handleViolation('Window lost focus');
        };

        const handleContextMenu = (e) => {
            e.preventDefault();
        };

        const handleCopyPaste = (e) => {
            e.preventDefault();
        };

        const handleKeyDown = (e) => {
            // Prevent F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U, Escape
            if (
                e.key === 'F12' ||
                e.key === 'Escape' ||
                (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) ||
                (e.ctrlKey && e.key.toUpperCase() === 'U')
            ) {
                e.preventDefault();

                if (e.key === 'Escape') {
                    enforceFullscreen();
                }
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleWindowBlur);
        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('copy', handleCopyPaste);
        document.addEventListener('paste', handleCopyPaste);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleWindowBlur);
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('copy', handleCopyPaste);
            document.removeEventListener('paste', handleCopyPaste);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isInterviewActive, handleViolation, enforceFullscreen]);

    return (
        <div
            ref={containerRef}
            className="w-full h-full min-h-screen bg-gray-50 flex flex-col relative"
            style={{ userSelect: 'none' }}
        >
            {!isInterviewActive ? (
                <PreInterviewModal 
                    isOpen={true} 
                    isLoading={isStarting}
                    onStart={startInterview} 
                    onBack={() => navigate('/candidate/jobs')} 
                />
            ) : (
                <div className="w-full h-full flex flex-col flex-1 relative">
                    {showWarning && (
                        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
                            <div className="bg-white p-8 rounded-xl max-w-md text-center shadow-2xl">
                                <h2 className="text-red-500 font-bold text-2xl mb-4">Security Warning</h2>
                                <p className="mb-6 text-gray-700">
                                    You must remain in fullscreen during the interview. Leaving may terminate your session.
                                    <br /><br />
                                    <strong className="text-gray-900">Violations: {violationCount} / {MAX_VIOLATIONS}</strong>
                                </p>
                                <button
                                    onClick={() => {
                                        setShowWarning(false);
                                        enforceFullscreen();
                                    }}
                                    className="px-6 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 transition"
                                >
                                    I Understand, Return to Interview
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="flex-1 w-full h-full overflow-hidden">
                        {children}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SecureInterviewWrapper;
