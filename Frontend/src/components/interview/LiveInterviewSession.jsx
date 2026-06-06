import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Mic,
    MicOff,
    Video,
    VideoOff,
    MessageSquare,
    User,
    Clock,
    ChevronRight,
    ChevronLeft,
    X,
    PhoneOff,
    Moon,
    Sun
} from 'lucide-react';
import { ConversationState } from '../../services/ConversationStateMachine';
import { correctGrammar } from '../../utils/grammarUtils';
import AITypingIndicator from './AITypingIndicator';
import TypewriterText from './TypewriterText';
import Logo from '../Logo';
import VoiceSpectrum from '../VoiceSpectrum';

// Premium Sync-driven Caption Component
const LiveCaption = ({ captionObj, isVisible, isDarkMode }) => {
    let words = [];
    let activeIndex = -1;
    
    if (typeof captionObj === 'string') {
        words = captionObj.split(' ').filter(w => w.length > 0);
        activeIndex = words.length - 1;
    } else if (captionObj && Array.isArray(captionObj.words)) {
        words = captionObj.words;
        activeIndex = captionObj.activeIndex;
    }
    
    const hasContent = words.length > 0;
    
    return (
        <div
            className={`transition-all duration-[400ms] ease-out transform max-w-3xl w-full mx-auto
                ${isVisible && hasContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}
            `}
        >
            <div 
                className={`py-3 px-5 md:py-4 md:px-6 rounded-[16px] backdrop-blur-xl border transition-colors duration-300 shadow-[0_8px_30px_rgba(0,0,0,0.12)] max-w-[85%] sm:max-w-xl md:max-w-2xl mx-auto text-center
                ${isDarkMode ? 'bg-black/60 border-gray-700/50' : 'bg-white/85 border-white/60'}`}
            >
                <div className={`text-lg sm:text-xl md:text-[22px] font-medium leading-[1.6] tracking-tight ${isDarkMode ? 'text-[#E5E7EB]' : 'text-[#111827]'} font-sans`}>
                    {hasContent ? words.map((word, idx) => {
                        const isActive = idx === activeIndex;
                        const isPast = idx < activeIndex;
                        
                        // Smart Grouping: Fade out lines far behind
                        if (activeIndex - idx > 12) return null; // Hide far past words
                        
                        let opacityClass = 'opacity-[0.15]';
                        let glowClass = '';
                        
                        if (isActive) {
                            opacityClass = 'opacity-100 font-semibold';
                            glowClass = isDarkMode ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'drop-shadow-[0_0_1px_rgba(0,0,0,0.6)]';
                        } else if (isPast) {
                            opacityClass = 'opacity-60';
                        }
                        
                        return (
                            <span key={idx} className={`inline-block mx-[3px] transition-all duration-[150ms] ${opacityClass} ${glowClass}`}>
                                {word}
                            </span>
                        );
                    }) : null}
                </div>
            </div>
        </div>
    );
};

const LiveInterviewSession = ({
    messages,
    status,
    interimText,
    candidateName,
    jobRole,
    onInterrupt,
    liveCaption, /* Accept liveCaption from App parent */
    onEndInterview,
    isConnected,
    onFrameCaptured // New prop for CV agent
}) => {
    // State
    const [isTranscriptVisible, setIsTranscriptVisible] = useState(true);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [isMicOn, setIsMicOn] = useState(true);
    const [isCamOn, setIsCamOn] = useState(true);

    // Dark Mode State
    const [isDarkMode, setIsDarkMode] = useState(() => {
        return sessionStorage.getItem('interview_theme') === 'dark';
    });

    useEffect(() => {
        sessionStorage.setItem('interview_theme', isDarkMode ? 'dark' : 'light');
    }, [isDarkMode]);

    // Derived State
    const isAiSpeaking = status === ConversationState.AI_SPEAKING;
    const isUserSpeaking = status === ConversationState.PROCESSING || interimText.length > 0;
    const isListening = status === ConversationState.LISTENING;

    // AI Thinking State for Typing Indicator
    const lastMessage = messages[messages.length - 1];
    const isAIThinking = status === ConversationState.PROCESSING && lastMessage?.role !== 'interviewer';

    // Timer
    useEffect(() => {
        const timer = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
        return () => clearInterval(timer);
    }, []);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Video Preview
    const videoRef = useRef(null);
    useEffect(() => {
        let activeStream = null;
        let isMounted = true;

        const startVideo = async () => {
            if (!isCamOn) {
                if (videoRef.current) videoRef.current.srcObject = null;
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                if (!isMounted) {
                    // Stop it immediately if the component unmounted while waiting for user permission
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                activeStream = stream;
                if (videoRef.current) videoRef.current.srcObject = stream;
            } catch (err) {
                console.error("Video access denied:", err);
            }
        };

        startVideo();

        return () => {
            isMounted = false;
            if (activeStream) {
                activeStream.getTracks().forEach(track => track.stop());
            }
            if (videoRef.current && videoRef.current.srcObject) {
                const tracks = videoRef.current.srcObject.getTracks();
                tracks.forEach(track => track.stop());
                videoRef.current.srcObject = null;
            }
        };
    }, [isCamOn]);

    // Frame Capture for CV Agent
    useEffect(() => {
        if (!isCamOn || !onFrameCaptured) return;
        
        const captureInterval = setInterval(() => {
            if (videoRef.current && videoRef.current.videoWidth > 0) {
                const canvas = document.createElement('canvas');
                canvas.width = videoRef.current.videoWidth;
                canvas.height = videoRef.current.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
                const base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
                onFrameCaptured(base64Image);
            }
        }, 1000); // 1 frame per second
        
        return () => clearInterval(captureInterval);
    }, [isCamOn, onFrameCaptured]);

    // Auto-scroll Transcript
    const transcriptRef = useRef(null);
    useEffect(() => {
        const scrollNode = transcriptRef.current;
        if (!scrollNode) return;

        // Create observer to constantly scroll down if new text is animated
        const observer = new MutationObserver(() => {
            scrollNode.scrollTo({
                top: scrollNode.scrollHeight,
                behavior: 'smooth'
            });
        });

        // Observe both child additions and text/character changes
        observer.observe(scrollNode, {
            childList: true,
            subtree: true,
            characterData: true
        });

        // Trigger an initial scroll just in case
        scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior: 'smooth' });

        return () => observer.disconnect();
    }, []);

    const spectrumMode = isAiSpeaking ? 'ai' : 'idle';

    return (
        <div className={`flex h-screen flex-col font-sans relative overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-[#0B0F19] text-[#E5E7EB]' : 'bg-[#FFFFFF] text-[#111827]'}`}>
            {/* Subtle Background Elements */}
            <div className={`absolute top-[-15%] left-[-10%] w-[40rem] h-[40rem] rounded-full filter blur-3xl opacity-60 pointer-events-none transition-colors duration-300 ${isDarkMode ? 'bg-gradient-to-br from-blue-900/20 to-transparent mix-blend-screen' : 'bg-gradient-to-br from-blue-50 to-transparent mix-blend-multiply'}`}></div>
            <div className={`absolute bottom-[-10%] right-[-10%] w-[35rem] h-[35rem] rounded-full filter blur-3xl opacity-60 pointer-events-none transition-colors duration-300 ${isDarkMode ? 'bg-gradient-to-tl from-indigo-900/20 to-transparent mix-blend-screen' : 'bg-gradient-to-tl from-indigo-50 to-transparent mix-blend-multiply'}`}></div>

            {/* TOP HEADER OVERLAY */}
            <header className="w-full max-w-7xl mx-auto py-6 px-8 flex items-center justify-between z-20 relative">
                <Logo className={`h-8 w-auto relative z-50 transition-all duration-300 ${isDarkMode ? 'brightness-0 invert' : ''}`} />
                
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsDarkMode(!isDarkMode)}
                        className={`p-2.5 rounded-full backdrop-blur-xl shadow-sm border transition-all duration-300 flex items-center justify-center transform 
                            ${isDarkMode 
                                ? 'bg-[#111827]/80 border-gray-800 text-yellow-400 hover:bg-[#1f2937] hover:rotate-[15deg] hover:scale-110' 
                                : 'bg-white/80 border-gray-100 text-yellow-500 hover:bg-gray-50 hover:-rotate-[15deg] hover:scale-110'
                            }`}
                        title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                    >
                        {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </button>

                    <div className={`px-5 py-2.5 backdrop-blur-xl rounded-full shadow-[0_2px_15px_rgba(0,0,0,0.03)] border flex items-center gap-4 transition-all duration-300 ${isDarkMode ? 'bg-[#111827]/80 border-gray-800' : 'bg-white/80 border-gray-100'}`}>
                        <span className={`text-sm font-semibold tracking-wide flex items-center gap-1.5 transition-colors duration-300 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            <Clock className={`w-4 h-4 ${isDarkMode ? 'text-[#4F8CFF]' : 'text-[#3A7DFF]'}`} />
                            <span className="tabular-nums w-10 text-center inline-block">{formatTime(elapsedTime)}</span>
                        </span>
                        
                        {isConnected !== undefined && (
                            <>
                                <div className={`w-px h-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                                {isConnected ? (
                                    <span className={`flex items-center gap-2 font-semibold text-sm transition-colors duration-300 ${isDarkMode ? 'text-gray-200' : 'text-[#111827]'}`}>
                                        <span className="relative flex h-2.5 w-2.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                                        </span>
                                        Connected
                                    </span>
                                ) : (
                                    <span className={`flex items-center gap-2 font-semibold text-sm transition-colors duration-300 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                        <span className="w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse"></span> 
                                        Connecting
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-1 w-full max-w-7xl mx-auto px-8 flex flex-col lg:flex-row gap-8 lg:gap-16 z-10 pb-8 h-[calc(100vh-100px)]">
                
                {/* Left Side - Transcript & Context */}
                <div className={`flex flex-col gap-6 max-w-md h-full transition-all duration-300 ease-in-out ${isTranscriptVisible ? 'w-full opacity-100' : 'w-0 opacity-0 overflow-hidden'}`}>
                    
                    {/* AI Avatar Card */}
                    <motion.div 
                        initial={{ opacity: 0, x: -20, y: 10 }}
                        animate={{ opacity: 1, x: 0, y: 0 }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                        className={`p-6 backdrop-blur-xl rounded-[24px] shadow-[0_8px_40px_rgb(0,0,0,0.04)] border flex items-center gap-5 transition-all duration-300 hover:shadow-[0_12px_50px_rgb(0,0,0,0.06)] shrink-0 ${isDarkMode ? 'bg-[#111827]/80 border-gray-800' : 'bg-white/80 border-gray-100'}`}
                    >
                        <div className="relative">
                            <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center p-[2px] shadow-sm ${isDarkMode ? 'from-[#1E40AF] to-[#4F8CFF]' : 'from-[#0a2a5e] to-[#3A7DFF]'}`}>
                                <div className={`w-full h-full rounded-[14px] flex items-center justify-center overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-[#0B0F19]' : 'bg-white'}`}>
                                    <Logo className={`w-8 h-auto object-contain transition-all duration-300 ${isDarkMode ? 'brightness-0 invert' : ''}`} />
                                </div>
                            </div>
                            {isAiSpeaking && (
                                <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isDarkMode ? 'bg-[#4F8CFF]' : 'bg-[#3A7DFF]'}`}></span>
                                    <span className={`relative inline-flex rounded-full h-4 w-4 border-2 ${isDarkMode ? 'bg-[#4F8CFF] border-[#111827]' : 'bg-[#3A7DFF] border-white'}`}></span>
                                </span>
                            )}
                        </div>
                        <div className="flex-1 flex justify-between items-start">
                            <div className="pr-2">
                                <h2 className={`text-lg font-bold tracking-tight transition-colors duration-300 ${isDarkMode ? 'text-white' : 'text-[#111827]'}`}>INTERVEUU AI</h2>
                                <p className={`text-sm font-medium mt-0.5 max-w-[180px] truncate transition-colors duration-300 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} title={jobRole}>
                                    {jobRole} Interview
                                </p>
                            </div>
                            <button onClick={() => setIsTranscriptVisible(false)} className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-400 hover:bg-gray-100'}`}>
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </motion.div>

                    {/* Transcript Area */}
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
                        className={`flex-1 backdrop-blur-xl rounded-[24px] p-6 shadow-[0_8px_40px_rgb(0,0,0,0.04)] border flex flex-col overflow-hidden min-h-0 relative transition-all duration-300 ${isDarkMode ? 'bg-[#111827]/80 border-gray-800' : 'bg-white/80 border-gray-100'}`}
                    >
                        <h3 className={`text-xs font-bold uppercase tracking-widest mb-5 flex items-center gap-2 shrink-0 transition-colors duration-300 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${isDarkMode ? 'bg-[#4F8CFF]' : 'bg-blue-500'}`}></div>
                            Live Transcript
                        </h3>
                        
                        <div className="flex-1 overflow-y-auto space-y-6 pr-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col" ref={transcriptRef}>
                            
                            {messages.length === 0 && (
                                <div className="flex items-center justify-center h-full text-gray-400 text-sm font-medium italic opacity-70">
                                    The interview is starting...
                                </div>
                            )}

                            {messages.map((msg, idx) => (
                                <motion.div 
                                    key={idx}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`flex flex-col gap-2 ${msg.role === 'candidate' ? 'items-end' : 'items-start'}`}
                                >
                                    {msg.role !== 'candidate' ? (
                                        <>
                                            <div className="flex items-center gap-2 ml-1">
                                                <div className={`w-6 h-6 rounded-md text-white flex items-center justify-center text-[10px] font-bold tracking-wider transition-colors duration-300 ${isDarkMode ? 'bg-[#1E40AF]' : 'bg-[#0a2a5e]'}`}>AI</div>
                                            </div>
                                            <div className={`p-4 lg:p-5 rounded-[20px] rounded-tl-sm border shadow-sm relative transition-colors duration-300 ${isDarkMode ? 'bg-[#1F2937] border-gray-800' : 'bg-[#F8FAFC] border-gray-100'}`}>
                                                <p className={`leading-relaxed text-sm whitespace-pre-wrap transition-colors duration-300 ${isDarkMode ? 'text-gray-200' : 'text-[#111827]'}`}><TypewriterText text={correctGrammar(msg.content)} typingSpeed={msg.speed || 40} /></p>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-2 mr-1">
                                                <span className={`text-xs font-medium transition-colors duration-300 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>You</span>
                                                <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold uppercase transition-colors duration-300 ${isDarkMode ? 'bg-gray-800 text-[#4F8CFF]' : 'bg-gray-200 text-[#0a2a5e]'}`}>
                                                    {candidateName ? candidateName.charAt(0) : 'U'}
                                                </div>
                                            </div>
                                            <div className={`p-4 lg:p-5 rounded-[20px] rounded-tr-sm shadow-[0_4px_14px_rgba(10,37,64,0.25)] text-white max-w-[90%] transition-colors duration-300 ${isDarkMode ? 'bg-[#3A7DFF]' : 'bg-[#0a2a5e]'}`}>
                                                <p className="text-sm leading-relaxed whitespace-pre-wrap opacity-95">{correctGrammar(msg.content)}</p>
                                            </div>
                                        </>
                                    )}
                                </motion.div>
                            ))}
                            
                            {/* Live user speaking interim text */}
                            <AnimatePresence mode="popLayout">
                            {interimText && (
                                <motion.div 
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    className="flex flex-col gap-2 items-end"
                                >
                                    <div className={`flex items-center gap-2 mt-2 mb-1 mr-1 transition-colors duration-300 ${isDarkMode ? 'text-[#4F8CFF]' : 'text-[#3A7DFF]'}`}>
                                        <Mic className="w-3.5 h-3.5 animate-pulse opacity-80" />
                                        <span className="text-xs font-medium opacity-80 italic animate-pulse">Listening...</span>
                                    </div>
                                    <div className={`p-4 rounded-[20px] rounded-tr-sm shadow-sm max-w-[90%] border transition-colors duration-300 ${isDarkMode ? 'bg-blue-900/20 border-blue-800/50' : 'bg-blue-50/80 border-blue-100'}`}>
                                        <p className={`text-sm leading-relaxed opacity-80 transition-colors duration-300 ${isDarkMode ? 'text-blue-100' : 'text-[#111827]'}`}>{correctGrammar(interimText)}...</p>
                                    </div>
                                </motion.div>
                            )}
                            </AnimatePresence>

                            {/* AI Typing Indicator */}
                            {isAIThinking && (
                                <div className="flex flex-col gap-2 items-start mt-2">
                                    <div className="flex items-center gap-2 ml-1">
                                        <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold transition-colors duration-300 ${isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'}`}>AI</div>
                                    </div>
                                    <div className={`py-3 px-5 rounded-[20px] rounded-tl-sm border shadow-sm relative w-fit transition-colors duration-300 ${isDarkMode ? 'bg-[#1F2937] border-gray-800' : 'bg-[#F8FAFC] border-gray-100'}`}>
                                        <AITypingIndicator isAIThinking={isAIThinking} />
                                    </div>
                                </div>
                            )}

                        </div>
                    </motion.div>
                </div>

                {/* Right Side - Spectrum & Main Focus */}
                <div className="flex-1 flex flex-col justify-center items-center relative py-12">
                   
                   {!isTranscriptVisible && (
                        <button
                            onClick={() => setIsTranscriptVisible(true)}
                            className={`absolute left-0 top-[15%] transform -translate-y-1/2 p-2.5 rounded-full border shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all z-30 flex items-center gap-2 hover:scale-105 ${isDarkMode ? 'bg-[#111827]/90 border-gray-800 hover:bg-[#1f2937]' : 'bg-white/90 border-gray-200 hover:bg-gray-50'}`}
                        >
                            <MessageSquare className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                            <span className={`text-xs font-medium px-1 pr-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Show Transcript</span>
                        </button>
                    )}

                    <div className={`absolute top-4 right-0 w-44 aspect-video bg-black rounded-2xl overflow-hidden shadow-xl border group z-30 ring-4 transition-colors duration-300 ${isDarkMode ? 'border-gray-800 ring-[#111827]/50' : 'border-gray-100 ring-white/50'}`}>
                        {isCamOn ? (
                            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" />
                        ) : (
                            <div className={`w-full h-full flex items-center justify-center ${isDarkMode ? 'bg-[#0B0F19]' : 'bg-[#111827]'}`}>
                                <VideoOff className="w-5 h-5 text-gray-500" />
                            </div>
                        )}
                        <div className="absolute bottom-2 left-2 text-[10px] font-bold bg-black/60 px-2 py-0.5 rounded-md text-white backdrop-blur-sm">
                            You
                        </div>
                    </div>

                    <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute top-12 lg:top-[15%] text-center w-full px-4 z-40 pointer-events-none"
                    >
                        <h3 className={`text-2xl font-semibold tracking-tight mb-3 drop-shadow-sm inline-block px-6 py-2 rounded-full backdrop-blur-md border transition-colors duration-300 ${isDarkMode ? 'text-[#E5E7EB] bg-[#111827]/40 border-gray-700/50' : 'text-[#111827] bg-white/40 border-white/50'}`}>
                            {isAiSpeaking ? "Interviewer speaking..." : isListening ? "Listening to you..." : "Analyzing..."}
                        </h3>
                        {/* Live Caption mapped correctly directly beneath title */}
                        <div className="min-h-[6rem] flex items-center justify-center w-full relative z-40">
                            <LiveCaption captionObj={liveCaption} isVisible={isAiSpeaking} isDarkMode={isDarkMode} />
                        </div>
                    </motion.div>

                    <div className="w-full flex justify-center scale-110 sm:scale-125 md:scale-[1.6] my-auto pointer-events-none origin-center transform translate-y-16 lg:translate-y-10 z-10">
                        <VoiceSpectrum 
                            mode={spectrumMode} 
                            isDarkMode={isDarkMode}
                            // audioStream not strictly needed since Component captures it internally if 'user'
                        />
                    </div>

                    {/* Controls */}
                    <motion.div 
                        initial={{ y: 30, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.3, type: "spring", stiffness: 400, damping: 25 }}
                        className={`absolute bottom-[2%] flex items-center gap-3 backdrop-blur-xl p-2.5 px-3 rounded-full border transition-all duration-300 ${isDarkMode ? 'bg-[#111827]/90 border-gray-800 shadow-[0_12px_40px_rgba(0,0,0,0.5)]' : 'bg-white/90 border-gray-200/50 shadow-[0_12px_40px_rgba(10,37,64,0.08)]'}`}
                    >
                        <ControlBtn
                            icon={isMicOn ? Mic : MicOff}
                            active={isMicOn}
                            onClick={() => setIsMicOn(!isMicOn)}
                            label={isMicOn ? "Mute" : "Unmute"}
                            colorClass={!isMicOn ? "bg-red-50 text-red-600 hover:bg-red-100" : (isDarkMode ? "bg-gray-800 text-gray-300 hover:bg-gray-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200")}
                        />
                        <ControlBtn
                            icon={isCamOn ? Video : VideoOff}
                            active={isCamOn}
                            onClick={() => setIsCamOn(!isCamOn)}
                            label={isCamOn ? "Stop Video" : "Start Video"}
                            colorClass={!isCamOn ? "bg-red-50 text-red-600 hover:bg-red-100" : (isDarkMode ? "bg-gray-800 text-gray-300 hover:bg-gray-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200")}
                        />

                        <div className="w-px h-8 bg-gray-200/60 mx-1"></div>

                        <button
                            className={`px-5 py-2.5 rounded-full font-medium transition-all text-sm flex items-center gap-2 hover:scale-[1.02] active:scale-95 shadow-[0_4px_14px_rgba(17,24,39,0.2)] ${isDarkMode ? 'bg-red-600/90 text-white hover:bg-red-600' : 'bg-[#111827] text-white hover:bg-[#1f2937]'}`}
                            onClick={() => {
                                if (onEndInterview) {
                                    onEndInterview();
                                } else {
                                    window.location.reload();
                                }
                            }}
                        >
                            <PhoneOff className={`w-4 h-4 ${isDarkMode ? 'text-white' : 'text-red-400'}`} />
                            End Interview
                        </button>
                    </motion.div>
                </div>
            </main>
        </div>
    );
};

// Updated ControlBtn to match new style
const ControlBtn = ({ icon: Icon, active, onClick, label, colorClass }) => (
    <button
        onClick={onClick}
        title={label}
        className={`p-3 rounded-full transition-all flex items-center justify-center w-11 h-11 ${colorClass}`}
    >
        <Icon className="w-5 h-5" />
    </button>
);

export default LiveInterviewSession;
