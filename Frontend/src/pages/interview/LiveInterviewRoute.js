import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import LiveInterviewSession from "../../components/interview/LiveInterviewSession";
import AudioRecorder from "../../components/interview/AudioRecorder";
import SecureInterviewWrapper from "../../components/interview/SecureInterviewWrapper";
import { conversationStateMachine, ConversationState } from "../../services/ConversationStateMachine";
import API_BASE_URL, { BACKEND_URL } from "../../apiConfig";

// Create a single, persistent audio element perfectly synced with VoiceSpectrum.
// This guarantees we never have to disconnect/reconnect the WebAudio AnalyserNode.
if (typeof window !== "undefined" && !window.aiAudioElement) {
    window.aiAudioElement = new window.Audio();
    window.aiAudioElement.crossOrigin = "anonymous";
}

const LiveInterviewRoute = () => {
    const location = useLocation();
    const navigate = useNavigate();

    // Extracted from InterviewPage navigation state
    const { sessionId, candidateName, jobTitle, isDemo } = location.state || {};

    const [currentState, setCurrentState] = useState(ConversationState.IDLE);
    const [isConnected, setIsConnected] = useState(false);
    const [messages, setMessages] = useState([]);
    const [liveCaption, setLiveCaption] = useState("");
    const [isEndModalOpen, setIsEndModalOpen] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [cvNotification, setCvNotification] = useState("");
    const cvNotificationTimeoutRef = useRef(null);

    const wordBufferRef = useRef([]);
    const captionIntervalRef = useRef(null);
    const ws = useRef(null);
    const audioRef = useRef(null);
    const audioQueueRef = useRef([]);
    const isPlayingRef = useRef(false);
    const emptyQueueTimeoutRef = useRef(null);
    const isConnecting = useRef(false);

    // If candidate landed here without going through the start form
    useEffect(() => {
        if (!sessionId) {
            navigate("/candidate/jobs"); // Fallback
        }
    }, [sessionId, navigate]);

    // Synchronized Caption Streaming Effect
    useEffect(() => {
        if (currentState === ConversationState.AI_SPEAKING) {
            captionIntervalRef.current = setInterval(() => {
                if (wordBufferRef.current.length > 0) {
                    const nextWord = wordBufferRef.current.shift();
                    setLiveCaption(prev => {
                        const words = prev ? prev.split(' ') : [];
                        if (words.length >= 5) {
                            return nextWord;
                        }
                        return prev ? prev + " " + nextWord : nextWord;
                    });
                }
            }, 270);
        } else {
            if (captionIntervalRef.current) clearInterval(captionIntervalRef.current);
            if (wordBufferRef.current.length > 0 || liveCaption) {
                const timer = setTimeout(() => {
                    setLiveCaption('');
                    wordBufferRef.current = [];
                }, 500);
                return () => clearTimeout(timer);
            }
        }
        return () => clearInterval(captionIntervalRef.current);
    }, [currentState, liveCaption]);

    const isWrappingUp = useRef(false);

    // Demo 3-minute max timer
    useEffect(() => {
        if (isDemo && hasStarted) {
            const timer = setTimeout(() => {
                if (ws.current?.readyState === WebSocket.OPEN) {
                    ws.current.close();
                }
                navigate("/candidate/interview-complete", { state: { sessionId, candidateName, jobTitle, isDemo, aborted: true } });
            }, 3 * 60 * 1000); // exactly 3 minutes
            return () => clearTimeout(timer);
        }
    }, [isDemo, hasStarted, navigate, sessionId, candidateName, jobTitle]);

    // --- WebSocket Logic ---
    useEffect(() => {
        if (!sessionId || !hasStarted) return;

        const unsubscribe = conversationStateMachine.subscribe((event) => {
            setCurrentState(event.to);
            if (event.from === ConversationState.AI_SPEAKING && event.to !== ConversationState.AI_SPEAKING) {
                setTimeout(() => setLiveCaption(''), 200);
            }
        });

        const connect = () => {
            if (ws.current || isConnecting.current) return;
            isConnecting.current = true;

            // Use BACKEND_URL for WebSocket (Vercel rewrites don't support WebSocket)
            const wsUrl = `${BACKEND_URL.replace(/\/+$/, "").replace(/^http/, 'ws')}/ws/interview/${sessionId}`;
            console.log("[WS] Connecting to:", wsUrl);
            const socket = new WebSocket(wsUrl);

            socket.onopen = () => {
                ws.current = socket;
                isConnecting.current = false;
                setIsConnected(true);

                // Immediately kick off the interview once socket opens
                socket.send(JSON.stringify({
                    type: 'start_interview',
                    payload: { candidate_name: candidateName, job_role: jobTitle }
                }));
            };

            socket.onclose = () => {
                ws.current = null;
                isConnecting.current = false;
                setIsConnected(false);
                conversationStateMachine.reset();
            };

            socket.onerror = (err) => console.error("WS Error:", err);

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleWebSocketMessage(data);
                } catch (e) {
                    console.error(e);
                }
            };
        };

        connect();

        return () => {
            unsubscribe();
            if (ws.current) ws.current.close();
            if (audioRef.current) audioRef.current.pause();
            if (cvNotificationTimeoutRef.current) clearTimeout(cvNotificationTimeoutRef.current);
        };
    }, [sessionId, candidateName, jobTitle, hasStarted]);

    const handleWebSocketMessage = (data) => {
        switch (data.type) {
            case 'session_created':
                conversationStateMachine.transition(ConversationState.LISTENING, { source: 'session_created' });
                break;
            case 'text_chunk':
                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.role === 'interviewer') {
                        const newPrev = [...prev];
                        newPrev[prev.length - 1] = { ...lastMsg, content: lastMsg.content + data.payload };
                        return newPrev;
                    }
                    return [...prev, { role: 'interviewer', content: data.payload }];
                });
                if (data.payload) {
                    const words = data.payload.split(' ').filter(w => w.length > 0);
                    wordBufferRef.current.push(...words);
                }
                break;
            case 'audio_output':
                queueAudio(data.payload);
                break;
            case 'transcription':
                setMessages(prev => [...prev, { role: 'candidate', content: data.payload }]);
                break;
            case 'report':
                isWrappingUp.current = true;
                if (!isPlayingRef.current) {
                    ws.current?.close();
                    navigate("/candidate/interview-complete", { state: { sessionId, candidateName, jobTitle, isDemo } });
                }
                break;
            case 'interview_concluding':
                isWrappingUp.current = true;
                if (!isPlayingRef.current) {
                    ws.current?.close();
                    navigate("/candidate/interview-complete", { state: { sessionId, candidateName, jobTitle, isDemo } });
                }
                break;
            case 'cv_notification':
                setCvNotification(data.payload);
                if (cvNotificationTimeoutRef.current) {
                    clearTimeout(cvNotificationTimeoutRef.current);
                }
                cvNotificationTimeoutRef.current = setTimeout(() => setCvNotification(""), 5000);
                break;
            default:
                break;
        }
    };

    // Cleanup empty queue timeouts on unmount
    useEffect(() => {
        return () => {
            if (emptyQueueTimeoutRef.current) clearTimeout(emptyQueueTimeoutRef.current);
        };
    }, []);

    const processAudioQueue = () => {
        if (isPlayingRef.current) return;
        
        if (audioQueueRef.current.length === 0) {
            // Queue finished
            if (isWrappingUp.current) {
                // Sequence finished. Wait a final 2 seconds for dramatic effect, then close.
                setTimeout(() => {
                    ws.current?.close();
                    navigate("/candidate/interview-complete", { state: { sessionId, candidateName, jobTitle, isDemo } });
                }, 2000);
            } else {
                emptyQueueTimeoutRef.current = setTimeout(() => {
                    if (!isPlayingRef.current) {
                        conversationStateMachine.transition(ConversationState.LISTENING, { source: 'audio_finished' });
                    }
                }, 400); 
            }
            return;
        }

        isPlayingRef.current = true;
        
        // If a timeout was counting down to go to LISTENING, cancel it perfectly!
        if (emptyQueueTimeoutRef.current) {
            clearTimeout(emptyQueueTimeoutRef.current);
            emptyQueueTimeoutRef.current = null;
        }
        
        const nextUrl = audioQueueRef.current.shift();
        
        // Reuse the exact same persistent HTML audio element!
        const audio = window.aiAudioElement;
        audioRef.current = audio;
        audio.src = nextUrl;
        
        audio.onplay = () => {
            if (conversationStateMachine.getState() !== ConversationState.AI_SPEAKING) {
                conversationStateMachine.transition(ConversationState.AI_SPEAKING, { source: 'audio_started' });
            }
        };
        
        audio.onended = () => {
            URL.revokeObjectURL(nextUrl);
            isPlayingRef.current = false;
            processAudioQueue(); // Process next item cleanly
        };
        
        audio.play().catch(e => {
            console.error("Audio play error", e);
            isPlayingRef.current = false;
            processAudioQueue(); // Skip to next if fails
        });
    };

    const queueAudio = (base64String) => {
        try {
            const byteCharacters = atob(base64String);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            
            // Push URL to queue
            audioQueueRef.current.push(url);
            
            // Call processQueue which will play it if nothing is currently playing
            processAudioQueue();
        } catch (e) {
            console.error(e);
        }
    };

    const handleInterrupt = () => {
        setLiveCaption('');
        audioQueueRef.current = []; // Wipe the pending queue
        isPlayingRef.current = false;
        
        if (emptyQueueTimeoutRef.current) {
            clearTimeout(emptyQueueTimeoutRef.current);
        }
        
        if (audioRef.current) {
            audioRef.current.onended = null;
            audioRef.current.pause();
            audioRef.current.src = ""; // Clear buffer
            audioRef.current = null;
        }
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ type: 'interrupt', payload: {} }));
        }
        conversationStateMachine.transition(ConversationState.CANDIDATE_INTERRUPTING);
        setTimeout(() => conversationStateMachine.transition(ConversationState.LISTENING), 150);
    };

    const handleAudioData = (audioBlob) => {
        if (conversationStateMachine.getState() !== ConversationState.LISTENING) return;
        conversationStateMachine.transition(ConversationState.PROCESSING);
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            if (ws.current?.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify({ type: 'audio_data', payload: base64Audio }));
            }
        };
    };

    const handleFrameCaptured = (base64Image) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ type: 'video_frame', payload: base64Image }));
        }
    };

    const handleEndInterview = () => {
        // Show the premium confirmation modal instead of directly dropping the websocket or sending text
        setIsEndModalOpen(true);
    };

    const confirmEndInterview = () => {
        setIsEndModalOpen(false);
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.close();
        }
        navigate("/candidate/interview-complete", { state: { sessionId, candidateName, jobTitle, aborted: true, isDemo } });
    };

    if (!sessionId) return null;

    return (
        <SecureInterviewWrapper
            sessionId={sessionId}
            candidateId={candidateName}
            onTerminate={confirmEndInterview}
            onStart={() => setHasStarted(true)}
        >
            <div className="min-h-screen bg-gray-50 flex flex-col relative w-full h-full">
                <div className="flex-1 overflow-hidden relative">
                    <LiveInterviewSession
                        messages={messages}
                        status={currentState}
                        interimText={""}
                        candidateName={candidateName || "Candidate"}
                        jobRole={jobTitle || "Role"}
                        onInterrupt={handleInterrupt}
                        liveCaption={liveCaption}
                        onEndInterview={handleEndInterview}
                        isConnected={isConnected}
                        onFrameCaptured={handleFrameCaptured}
                    />

                    <AudioRecorder
                        onAudioData={handleAudioData}
                        onInterrupt={handleInterrupt}
                        isRecording={currentState === ConversationState.LISTENING}
                        isDetectingInterrupt={false}
                    />
                    
                    {/* CV Notification Toast */}
                    <AnimatePresence>
                        {cvNotification && (
                            <motion.div
                                initial={{ opacity: 0, y: -20, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -20, scale: 0.9 }}
                                className="absolute top-24 left-1/2 transform -translate-x-1/2 z-50 bg-red-500 text-white px-6 py-3 rounded-full shadow-lg font-semibold flex items-center gap-3"
                            >
                                <AlertTriangle className="w-5 h-5" />
                                {cvNotification}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Premium End Interview Confirmation Modal */}
                {isEndModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-opacity">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 animate-in fade-in zoom-in duration-200">
                            <div className="bg-red-50 p-6 flex flex-col items-center justify-center border-b border-red-100">
                                <div className="bg-white p-3 rounded-full shadow-sm mb-4">
                                    <AlertTriangle className="w-10 h-10 text-red-500" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-800 text-center">Terminate Interview Early?</h2>
                            </div>
                            <div className="p-6 text-center">
                                <p className="text-slate-600 mb-6">
                                    We are just getting started! Ending the interview now before completing all questions will <span className="font-semibold text-red-600">negatively impact your evaluation</span>.
                                    <br /><br />Are you sure you want to conclude?
                                </p>
                                <div className="flex flex-col sm:flex-row gap-3">
                                    <button
                                        onClick={() => setIsEndModalOpen(false)}
                                        className="flex-1 py-3 px-4 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 transition-colors"
                                    >
                                        No, Continue Interview
                                    </button>
                                    <button
                                        onClick={confirmEndInterview}
                                        className="flex-1 py-3 px-4 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 shadow-md hover:shadow-lg transition-all"
                                    >
                                        Yes, End Now
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </SecureInterviewWrapper>
    );
};

export default LiveInterviewRoute;
