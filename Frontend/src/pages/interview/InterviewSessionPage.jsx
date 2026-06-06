import { useState, useEffect, useRef } from 'react';
import LiveInterviewSession from '../../components/interview/LiveInterviewSession';
import InterviewReport from '../../components/interview/InterviewReport';
import AudioRecorder from '../../components/interview/AudioRecorder';
import DebugPanel from '../../components/interview/DebugPanel';
import { conversationStateMachine, ConversationState } from '../../services/ConversationStateMachine';
import CandidateDashboard from '../../components/interview/CandidateDashboard';
import SecureInterviewWrapper from '../../components/interview/SecureInterviewWrapper';
import API_BASE_URL, { BACKEND_URL } from '../../apiConfig';

function App() {
  const [currentState, setCurrentState] = useState(ConversationState.IDLE);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isConcluding, setIsConcluding] = useState(false);
  const isWrappingUp = useRef(false);
  const [messages, setMessages] = useState([]);
  const [interimText, setInterimText] = useState('');
  const [liveCaption, setLiveCaption] = useState(''); // Live caption state
  const audioQueueRef = useRef([]); // FIFO Audio Queue
  const endInterviewTimerRef = useRef(null); // Fix for overlapping listening state resets
  const activeAudiosRef = useRef(new Set()); // For Crossfading multiple audios
  const isBufferingRef = useRef(false);
  const isGeneratingRef = useRef(false); // FLAG for response-level state lock

  const [activeSentence, setActiveSentence] = useState(null); // { text, audioObj, words }
  
  // Custom caption rendering engine mapped to audio.currentTime
  useEffect(() => {
    if (!activeSentence || !activeSentence.audioObj) {
      return;
    }

    const { audioObj, words } = activeSentence;
    if (words.length === 0) return;

    let animationFrameId;

    const renderCaption = () => {
      let progress = 0;
      if (audioObj.duration && audioObj.duration > 0) {
        progress = audioObj.currentTime / audioObj.duration;
      }
      
      const wordsToShow = Math.max(1, Math.ceil(progress * words.length));
      
      setLiveCaption({
        words,
        activeIndex: wordsToShow - 1,
        progress
      });
      
      if (progress < 1) {
        animationFrameId = requestAnimationFrame(renderCaption);
      }
    };

    animationFrameId = requestAnimationFrame(renderCaption);

    return () => cancelAnimationFrame(animationFrameId);
  }, [activeSentence]);

  const [reportData, setReportData] = useState(null); // Stores report when interview ends

  // Hardcoded config for now, or passed from Dashboard
  const [config, setConfig] = useState({
    candidate_name: 'Ayyash',
    job_role: 'Python Developer'
  });

  // Debug state
  const [debugInfo, setDebugInfo] = useState({
    wsStatus: 'Disconnected',
    status: 'IDLE',
    events: [],
    lastMessage: 'None'
  });

  // Refs
  const ws = useRef(null);
  const audioRef = useRef(null);
  const isConnecting = useRef(false);

  // Helper to log debug events
  const logDebug = (event) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugInfo(prev => ({
      ...prev,
      events: [`[${timestamp}] ${event}`, ...prev.events].slice(0, 20)
    }));
  };

  // --- WebSocket Logic ---
  useEffect(() => {
    if (!hasStarted) return;
    const unsubscribe = conversationStateMachine.subscribe((event) => {
      setCurrentState(event.to);
      setDebugInfo(prev => ({ ...prev, status: event.to }));

      // Clear caption when AI stops speaking
      if (event.from === ConversationState.AI_SPEAKING && event.to !== ConversationState.AI_SPEAKING) {
        setTimeout(() => setLiveCaption(''), 200);
      }
    });

    const connect = () => {
      if (ws.current || isConnecting.current) return;
      isConnecting.current = true;
      logDebug('🔌 Connecting...');

      // Use BACKEND_URL for WebSocket (Vercel rewrites don't support WebSocket)
      const wsUrl = BACKEND_URL.replace(/^http/, 'ws') + '/ws/interview';
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        logDebug('✅ Connected');
        ws.current = socket;
        isConnecting.current = false;
        setIsConnected(true);
        setDebugInfo(prev => ({ ...prev, wsStatus: 'Connected' }));
      };

      socket.onclose = () => {
        logDebug('❌ Disconnected');
        ws.current = null;
        isConnecting.current = false;
        setIsConnected(false);
        setDebugInfo(prev => ({ ...prev, wsStatus: 'Disconnected' }));
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
    };
  }, [hasStarted]);

  // --- Message Handling ---
  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'session_created':
        logDebug('✅ Session Started');
        setSessionActive(true);
        isGeneratingRef.current = true;
        conversationStateMachine.transition(ConversationState.PROCESSING, { source: 'session_created' });
        break;

      case 'text_chunk':
        // Audio is now the single source of truth, text_chunks ignored for captions
        break;

      case 'audio_output':
        logDebug(`🔊 Audio Received`);
        isGeneratingRef.current = true; // Ensure state lock
        if (endInterviewTimerRef.current) {
            clearTimeout(endInterviewTimerRef.current);
            endInterviewTimerRef.current = null;
        }
        audioQueueRef.current.push({ audio: data.payload, text: data.text });
        processAudioQueue();
        break;

      case 'transcription':
        logDebug(`📝 Transcription: ${data.payload}`);
        setInterimText(''); // Clear interim text
        setMessages(prev => {
          // If the last message was 'interviewer', append new candidate message
          // If last was 'candidate', replace/append? Ideally append if it's a new chunk.
          // But since STT is one-shot per utterance, just append new message.
          return [...prev, { role: 'candidate', content: data.payload }];
        });
        break;

      case 'report':
        logDebug('📊 Report Received');
        isWrappingUp.current = true;
        setReportData(data.payload);
        if (!audioRef.current || audioRef.current.paused) {
          setIsConcluding(false);
          setSessionActive(false); // Switch to report view
        }
        break;

      case 'interview_concluding':
        logDebug('⏳ Interview Concluding... Generating Report');
        isWrappingUp.current = true;
        if (!audioRef.current || audioRef.current.paused) {
          setIsConcluding(true);
        }
        break;

      case 'response_complete':
        logDebug('✅ Response Complete');
        isGeneratingRef.current = false;
        // Trigger condition for audio queue finished
        if (activeAudiosRef.current.size === 0 && audioQueueRef.current.length === 0) {
            endInterviewTimerRef.current = setTimeout(() => {
                // Strict Failsafe check to prevent false positives
                if (!isGeneratingRef.current && activeAudiosRef.current.size === 0) {
                    setLiveCaption(null);
                    setActiveSentence(null);
                    conversationStateMachine.transition(ConversationState.LISTENING, { source: 'response_complete' });
                }
            }, 600); 
        }
        break;
    }
  };

  // --- Audio Logic ---
  const processAudioQueue = () => {
    if (audioQueueRef.current.length === 0) return;
    
    // CRITICAL FIX: If audio is currently playing, DO NOT force playback! 
    // The existing audio's `ontimeupdate` or `onended` events will safely pull the next chunk from the queue.
    if (activeAudiosRef.current.size > 0) {
        return;
    }
    
    // Check if this is the start of the response or a mid-response gap
    const isMidResponseGap = conversationStateMachine.getState() === ConversationState.AI_SPEAKING;
    
    // Feature 4: Buffer until 2 chunks ready ONLY for the first chunks to eliminate initial gaps.
    // If we're mid-response and starved, play immediately to reduce robotic pausing.
    if (!isMidResponseGap && audioQueueRef.current.length < 2 && !isWrappingUp.current) {
        if (!isBufferingRef.current) {
            isBufferingRef.current = true;
            // 1.0s fallback timeout in case the LLM only outputs 1 chunk overall
            setTimeout(() => {
                if (isBufferingRef.current) {
                    processAudioQueueForce();
                }
            }, 1000);
        }
        return; 
    }
    
    processAudioQueueForce();
  };

  const processAudioQueueForce = () => {
    if (audioQueueRef.current.length === 0) return;
    isBufferingRef.current = false;
    
    const { audio: base64String, text } = audioQueueRef.current.shift();

    try {
      const byteCharacters = atob(base64String);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audio.crossfadeTriggered = false;
      activeAudiosRef.current.add(audio);
      audioRef.current = audio;
      
      const sentenceWords = (text || "").split(' ').filter(w => w.trim().length > 0);

      audio.onplay = () => {
        // Render captions exactly matched to current audio time!
        setActiveSentence({ text, audioObj: audio, words: sentenceWords });

        // Push text to transcript immediately
        if (text) {
          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === 'interviewer') {
              const newPrev = [...prev];
              newPrev[prev.length - 1] = {
                ...lastMsg,
                content: lastMsg.content + " " + text,
                speed: 0 // instantly appear since we use continuous audio pacing
              };
              return newPrev;
            }
            return [...prev, { role: 'interviewer', content: text, speed: 0 }];
          });
        }
        
        conversationStateMachine.transition(ConversationState.AI_SPEAKING, { source: 'audio_started' });
      };

      // Feature 6: Crossfade logic
      audio.ontimeupdate = () => {
          if (audio.duration && audio.currentTime >= Math.max(0, audio.duration - 0.2)) { // 200ms overlap
              if (!audio.crossfadeTriggered) {
                  audio.crossfadeTriggered = true;
                  if (audioQueueRef.current.length > 0) {
                      processAudioQueueForce();
                  }
              }
          }
      };

      audio.onended = () => {
        URL.revokeObjectURL(url);
        activeAudiosRef.current.delete(audio);
        
        if (activeAudiosRef.current.size === 0 && audioQueueRef.current.length === 0) {
            if (isWrappingUp.current) {
              if (reportData) {
                setIsConcluding(false);
                setSessionActive(false);
              } else {
                setIsConcluding(true);
              }
            } else if (!isGeneratingRef.current) {
              // Feature 7/8: Spectrum State Control & Continuity Layer
              endInterviewTimerRef.current = setTimeout(() => {
                // Strict Failsafe check to prevent false positives
                if (!isGeneratingRef.current && activeAudiosRef.current.size === 0) {
                    setLiveCaption(null);
                    setActiveSentence(null);
                    conversationStateMachine.transition(ConversationState.LISTENING, { source: 'audio_finished' });
                }
              }, 600); 
            } else {
              // We are still generating. Gap masking: do NOT clear UI! keep in SPEAKING mode!
            }
        } else if (audioQueueRef.current.length > 0 && activeAudiosRef.current.size === 0) {
            // Failsafe queue trigger
            processAudioQueueForce();
        }
      };

      audio.play().catch(e => {
        logDebug(`⚠️ Play Error: ${e.message}`);
        activeAudiosRef.current.delete(audio);
        if (audioQueueRef.current.length > 0) processAudioQueueForce();
      });
    } catch (e) {
      console.error(e);
      if (audioQueueRef.current.length > 0) processAudioQueueForce();
    }
  };

  // --- User Actions ---
  const startInterview = () => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'start_interview', payload: config }));
    } else {
      // Mock start for UI testing if backend offline (Optional)
      console.warn("Backend not connected, cannot start interview.");
    }
  };

  const handleInterrupt = () => {
    logDebug('🛑 Interrupt!');
    setLiveCaption(''); // Clear caption on interrupt
    setActiveSentence(null);
    
    if (endInterviewTimerRef.current) {
        clearTimeout(endInterviewTimerRef.current);
        endInterviewTimerRef.current = null;
    }
    
    audioQueueRef.current = []; // Clear queue
    isBufferingRef.current = false;
    
    activeAudiosRef.current.forEach(audioObj => {
        audioObj.pause();
        audioObj.onended = null;
        audioObj.ontimeupdate = null;
    });
    activeAudiosRef.current.clear();
    audioRef.current = null;
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'interrupt', payload: {} }));
    }
    conversationStateMachine.transition(ConversationState.CANDIDATE_INTERRUPTING);
    setTimeout(() => conversationStateMachine.transition(ConversationState.LISTENING), 150);
  };

  const handleAudioData = (audioBlob) => {
    if (conversationStateMachine.getState() !== ConversationState.LISTENING) return;

    isGeneratingRef.current = true; // Set generation lock
    conversationStateMachine.transition(ConversationState.PROCESSING);

    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = () => {
      const base64Audio = reader.result.split(',')[1];
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'audio_data', payload: base64Audio }));
      }
    };

    // Simulate live transcript (Removed for real transcription)
    // setMessages(prev => [...prev, { role: 'candidate', content: "(Audio sent...)" }]);
  };

  const handleEndInterview = () => {
    if (window.confirm("Are you sure you want to end the interview?")) {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.close();
      }
      setSessionActive(false);
      window.location.reload();
    }
  };

  // --- Render ---

  // 1. Setup Screen (New Dashboard)
  if (!sessionActive && !reportData && !isConcluding) {
    return (
      <CandidateDashboard
        candidateName={config.candidate_name}
        onStartInterview={startInterview}
      />
    );
  }

  // 2. Report Screen
  if (reportData && !isConcluding) {
    return <InterviewReport reportData={reportData} onRestart={() => window.location.reload()} />;
  }

  // 3. Concluding Loading Screen
  if (isConcluding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white font-sans">
        <div className="flex flex-col items-center gap-6">
          <div className="relative flex items-center justify-center">
            <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
            <div className="absolute w-8 h-8 border-4 border-indigo-500/20 border-b-indigo-500 rounded-full animate-spin-reverse"></div>
          </div>
          <div className="text-center">
            <h3 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent mb-2">Finalizing Interview</h3>
            <p className="text-slate-400 animate-pulse text-sm">Calculing metrics and generating AI feedback report...</p>
          </div>
        </div>
      </div>
    );
  }

  // 4. Live Interview Screen
  return (
    <SecureInterviewWrapper
      candidateId={config.candidate_name}
      onTerminate={handleEndInterview}
      onStart={() => setHasStarted(true)}
    >
      <LiveInterviewSession
        messages={messages}
        status={currentState}
        interimText={interimText}
        candidateName={config.candidate_name}
        jobRole={config.job_role}
        onInterrupt={handleInterrupt}
        liveCaption={liveCaption}
        onEndInterview={handleEndInterview}
        isConnected={isConnected}
      />

      <AudioRecorder
        onAudioData={handleAudioData}
        onInterrupt={handleInterrupt}
        isRecording={currentState === ConversationState.LISTENING}
        isDetectingInterrupt={false}
      />
    </SecureInterviewWrapper>
  );
}

export default App;
