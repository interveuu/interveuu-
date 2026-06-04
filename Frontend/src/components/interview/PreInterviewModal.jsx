import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Camera, Volume2, Shield, Clock,
  ArrowRight, ArrowLeft, Check
} from 'lucide-react';

const guidelines = [
  {
    title: "Audio & Video",
    desc: "Ensure your webcam and microphone are on. Good lighting helps our AI analyze your non-verbal cues accurately.",
    icon: Camera,
    color: "text-blue-600",
    bg: "bg-blue-50"
  },
  {
    title: "Environment",
    desc: "Find a quiet, distraction-free space. Background noise or other people in the frame may negatively impact your evaluation.",
    icon: Volume2,
    color: "text-purple-600",
    bg: "bg-purple-50"
  },
  {
    title: "Fairness Policy",
    desc: "Do not use external AI tools or seek help. Tab switching and exiting fullscreen are strictly monitored and may terminate the session.",
    icon: Shield,
    color: "text-red-600",
    bg: "bg-red-50"
  },
  {
    title: "The Process",
    desc: "Speak clearly and wait for the AI to finish before answering. The interview will take approximately 15-20 minutes.",
    icon: Clock,
    color: "text-amber-600",
    bg: "bg-amber-50"
  }
];

export default function PreInterviewModal({ onStart, onBack, isOpen = true, isLoading = false }) {
  const [agreed, setAgreed] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] h-screen w-screen overflow-hidden bg-white flex flex-col md:flex-row font-sans">
      
      {/* Left Panel - Branding/Intro */}
      <div className="md:w-[35%] h-full bg-[#0a2a5e] text-white p-10 lg:p-16 flex flex-col relative overflow-hidden">
        {/* Background decorative elements */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-white opacity-5 blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 rounded-full bg-blue-400 opacity-10 blur-3xl pointer-events-none"></div>

        <div className="relative z-10">
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-10 backdrop-blur-md border border-white/20 shadow-lg"
          >
            <Shield className="text-blue-300" size={28} />
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl lg:text-5xl font-bold leading-tight mb-6 tracking-tight"
          >
            Ready for your<br/>AI Interview?
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="text-blue-200 text-lg leading-relaxed max-w-sm"
          >
            Just a few simple guidelines to ensure a smooth, accurate, and fair assessment process.
          </motion.p>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-auto relative z-10 pt-12 hidden md:block"
        >
          <div className="p-6 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm relative">
             <div className="absolute -top-3 -left-2 text-4xl text-blue-400/30 font-serif">"</div>
             <p className="text-sm text-blue-100 italic relative z-10 font-medium leading-relaxed">
               Relax, be yourself, and treat this just like a conversation with a real recruiter. We're excited to learn more about you!
             </p>
          </div>
        </motion.div>
      </div>

      {/* Right Panel - Content */}
      <div className="md:w-[65%] h-full bg-slate-50 flex flex-col p-6 md:p-10 lg:p-16 relative">
         
         <div className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full h-full">
            
            <motion.h2 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-2xl font-bold text-slate-800 mb-8 tracking-tight"
            >
              Interview Guidelines
            </motion.h2>

            {/* Grid of Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 mb-10 lg:mb-12">
              {guidelines.map((item, idx) => (
                <motion.div 
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + (idx * 0.1), duration: 0.5, ease: "easeOut" }}
                  className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 hover:shadow-md transition-shadow group flex flex-col h-full"
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${item.bg} ${item.color} transition-transform group-hover:scale-110`}>
                    <item.icon size={24} strokeWidth={2.5} />
                  </div>
                  <h3 className="font-bold text-slate-800 text-lg mb-2">{item.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed flex-1">{item.desc}</p>
                </motion.div>
              ))}
            </div>

            {/* Footer / Actions */}
            <motion.div 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: 0.7 }}
               className="bg-white p-5 lg:p-6 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60 flex flex-col sm:flex-row items-center justify-between gap-6 mt-auto md:mt-0"
            >
              <label className="flex items-center gap-4 cursor-pointer group flex-1 w-full p-2">
                <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all duration-200 flex-shrink-0 ${
                  agreed 
                    ? 'bg-[#0a2a5e] border-[#0a2a5e] text-white shadow-md' 
                    : 'border-slate-300 group-hover:border-[#0a2a5e] bg-white'
                }`}>
                  {agreed && <Check size={16} strokeWidth={3} />}
                </div>
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span className={`select-none text-base transition-colors font-semibold ${
                  agreed ? 'text-slate-900' : 'text-slate-500 group-hover:text-slate-700'
                }`}>
                  I agree to follow the guidelines.
                </span>
              </label>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button 
                  onClick={onBack}
                  disabled={isLoading}
                  className="px-6 py-3.5 rounded-xl text-slate-500 font-bold hover:bg-slate-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <ArrowLeft size={20} />
                  Back
                </button>
                <button 
                  disabled={!agreed || isLoading}
                  onClick={onStart}
                  className={`px-8 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-300 whitespace-nowrap ${
                    agreed && !isLoading
                      ? 'bg-[#0a2a5e] hover:bg-[#0d3b82] text-white shadow-xl shadow-blue-900/20 hover:-translate-y-0.5' 
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {isLoading ? "Requesting..." : "Start Interview"}
                  {!isLoading && <ArrowRight size={20} />}
                </button>
              </div>
            </motion.div>

         </div>
      </div>
    </div>
  );
}
