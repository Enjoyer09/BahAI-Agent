// ==========================================
// Voice Mode — ChatGPT-style full-screen voice chat
// ==========================================
// Animated orb + mute/end/speaker controls
// STT: Web Speech API | TTS: Fish Audio S2.1 Pro Free

import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, X, Volume2, VolumeX, Phone } from 'lucide-react';

interface Props {
  onSend: (text: string) => void;
  onClose: () => void;
  lastAssistantMessage?: string;
  isLoading: boolean;
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
export const speechSupported = Boolean(SpeechRecognition);

export default function VoiceMode({ onSend, onClose, lastAssistantMessage, isLoading }: Props) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevAssistantRef = useRef<string>('');
  const activeRef = useRef(true);
  const speakerOffRef = useRef(false);

  // Keep ref in sync
  useEffect(() => { speakerOffRef.current = isSpeakerOff; }, [isSpeakerOff]);

  // ── STT ──
  const failCountRef = useRef(0);
  const startListening = useCallback(() => {
    if (!speechSupported || isMuted) return;
    // Prevent infinite restart loop
    if (failCountRef.current > 3) {
      setError('Səs tanıma xidməti əlçatan deyil. Səhifəni yeniləyin və ya Chrome mobil istifadə edin.');
      setState('idle');
      return;
    }
    setError(null);
    setTranscript('');

    const recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setState('listening');
      failCountRef.current = 0; // Reset on successful start
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(final || interim);
      recognition._finalTranscript = final;
    };

    recognition.onend = () => {
      const text = recognitionRef.current?._finalTranscript?.trim();
      if (text && text.length > 0) {
        setState('processing');
        onSend(text);
      } else if (activeRef.current && !isMuted) {
        setTimeout(() => {
          if (activeRef.current) startListening();
        }, 500);
      } else {
        setState('idle');
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        if (activeRef.current && !isMuted) {
          setTimeout(() => { if (activeRef.current) startListening(); }, 800);
        } else {
          setState('idle');
        }
        return;
      }
      if (event.error === 'aborted') {
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        failCountRef.current += 1;
        setError('Mikrofon icazəsi yoxdur. Brauzer ayarlarından icazə verin.');
        setState('idle');
      } else if (event.error === 'network') {
        failCountRef.current += 1;
        setError('İnternet bağlantısı lazımdır.');
        setState('idle');
      } else {
        failCountRef.current += 1;
        setError(`Xəta: ${event.error}`);
        setState('idle');
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e: any) {
      failCountRef.current += 1;
      setError(`Mikrofon başlada bilmədi: ${e?.message || 'unknown'}`);
      setState('idle');
    }
  }, [onSend, isMuted]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
  }, []);

  // ── TTS ──
  const speak = useCallback(async (text: string) => {
    if (!text || speakerOffRef.current) {
      setState('idle');
      if (activeRef.current) setTimeout(startListening, 300);
      return;
    }

    setState('speaking');
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
        },
        body: JSON.stringify({ text: text.slice(0, 4000) }),
      });

      if (!response.ok) {
        throw new Error(`TTS: ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setState('idle');
        if (activeRef.current) setTimeout(startListening, 300);
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setState('idle');
        if (activeRef.current) setTimeout(startListening, 300);
      };

      await audio.play();
    } catch (err) {
      console.error('[VoiceMode] TTS error:', err);
      setState('idle');
      if (activeRef.current) setTimeout(startListening, 300);
    }
  }, [startListening]);

  // ── Watch assistant messages ──
  useEffect(() => {
    if (!lastAssistantMessage) return;
    if (lastAssistantMessage === prevAssistantRef.current) return;
    if (isLoading) return;

    prevAssistantRef.current = lastAssistantMessage;

    const cleanText = lastAssistantMessage
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[-*•]\s/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (cleanText.length > 0) {
      speak(cleanText);
    }
  }, [lastAssistantMessage, isLoading, speak]);

  // ── Auto-start on mount ──
  useEffect(() => {
    activeRef.current = true;
    startListening();
    return () => {
      activeRef.current = false;
      stopListening();
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ESC to close ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mute toggle ──
  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      if (state === 'idle') setTimeout(startListening, 100);
    } else {
      setIsMuted(true);
      stopListening();
      if (state === 'listening') setState('idle');
    }
  };

  // ── Speaker toggle ──
  const toggleSpeaker = () => {
    if (isSpeakerOff) {
      setIsSpeakerOff(false);
    } else {
      setIsSpeakerOff(true);
      // Stop current audio
      if (audioRef.current && state === 'speaking') {
        audioRef.current.pause();
        setState('idle');
        if (activeRef.current && !isMuted) setTimeout(startListening, 200);
      }
    }
  };

  // ── End call ──
  const handleClose = () => {
    activeRef.current = false;
    stopListening();
    if (audioRef.current) {
      audioRef.current.pause();
    }
    onClose();
  };

  // ── Interrupt (tap orb while speaking) ──
  const handleOrbTap = () => {
    if (state === 'speaking' && audioRef.current) {
      audioRef.current.pause();
      setState('idle');
      if (!isMuted) setTimeout(startListening, 200);
    }
  };

  if (!speechSupported) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
        <div className="text-center p-8">
          <p className="text-white text-lg mb-4">Bu brauzer səs rejimini dəstəkləmir</p>
          <p className="text-white/50 text-sm mb-6">Chrome və ya Edge istifadə edin</p>
          <button onClick={onClose} className="px-5 py-2.5 bg-white/10 rounded-full text-white text-sm hover:bg-white/20 transition">
            Bağla
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#0d0d0f] select-none">
      {/* ── Top: transcript ── */}
      <div className="flex-shrink-0 pt-16 px-6 text-center max-w-lg w-full">
        {transcript && state === 'listening' && (
          <p className="text-white/80 text-base leading-relaxed animate-in fade-in">
            {transcript}
          </p>
        )}
        {state === 'processing' && (
          <p className="text-white/50 text-sm">Düşünür...</p>
        )}
        {error && (
          <p className="text-red-400/90 text-sm mt-2">{error}</p>
        )}
      </div>

      {/* ── Center: Animated Orb ── */}
      <div className="flex-1 flex items-center justify-center">
        <button
          onClick={handleOrbTap}
          disabled={state !== 'speaking'}
          className="relative focus:outline-none"
          aria-label={state === 'speaking' ? 'Kəs' : ''}
        >
          {/* Outer glow rings */}
          <div
            className="absolute inset-0 rounded-full transition-all duration-700"
            style={{
              transform: 'scale(1.4)',
              background: state === 'listening'
                ? 'radial-gradient(circle, rgba(99,179,255,0.15), transparent 70%)'
                : state === 'speaking'
                ? 'radial-gradient(circle, rgba(16,163,127,0.15), transparent 70%)'
                : state === 'processing'
                ? 'radial-gradient(circle, rgba(168,130,255,0.12), transparent 70%)'
                : 'radial-gradient(circle, rgba(255,255,255,0.05), transparent 70%)',
            }}
          />
          {state === 'listening' && (
            <div className="absolute inset-0 rounded-full animate-ping opacity-20 bg-blue-400" style={{ animationDuration: '2s' }} />
          )}
          {state === 'speaking' && (
            <div className="absolute inset-0 rounded-full animate-pulse opacity-20 bg-emerald-400" style={{ animationDuration: '1.5s' }} />
          )}

          {/* Main orb */}
          <div
            className="relative w-36 h-36 sm:w-44 sm:h-44 rounded-full transition-all duration-500"
            style={{
              background: state === 'listening'
                ? 'radial-gradient(circle at 35% 35%, #60b5ff, #2563eb, #1e40af)'
                : state === 'speaking'
                ? 'radial-gradient(circle at 35% 35%, #4eeac0, #10a37f, #065f46)'
                : state === 'processing'
                ? 'radial-gradient(circle at 35% 35%, #c4a5ff, #7c3aed, #4c1d95)'
                : 'radial-gradient(circle at 35% 35%, #6b7280, #374151, #1f2937)',
              boxShadow: state === 'listening'
                ? '0 0 80px rgba(37,99,235,0.35), inset 0 -20px 40px rgba(0,0,0,0.3)'
                : state === 'speaking'
                ? '0 0 80px rgba(16,163,127,0.35), inset 0 -20px 40px rgba(0,0,0,0.3)'
                : state === 'processing'
                ? '0 0 60px rgba(124,58,237,0.25), inset 0 -20px 40px rgba(0,0,0,0.3)'
                : '0 0 40px rgba(0,0,0,0.3), inset 0 -20px 40px rgba(0,0,0,0.3)',
              animation: state === 'speaking' ? 'orb-breathe 2s ease-in-out infinite' : undefined,
            }}
          >
            {/* Inner highlight */}
            <div
              className="absolute top-[15%] left-[20%] w-[30%] h-[30%] rounded-full opacity-40"
              style={{
                background: 'radial-gradient(circle, rgba(255,255,255,0.6), transparent)',
              }}
            />
          </div>
        </button>
      </div>

      {/* ── Bottom: Controls ── */}
      <div className="flex-shrink-0 pb-12 sm:pb-16 px-6 w-full max-w-sm">
        <div className="flex items-center justify-between">
          {/* Mute button */}
          <button
            onClick={toggleMute}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
            style={{
              background: isMuted ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.08)',
              border: isMuted ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.1)',
            }}
            aria-label={isMuted ? 'Mikrofonu aç' : 'Mikrofonu söndür'}
          >
            {isMuted
              ? <MicOff size={22} className="text-red-400" />
              : <Mic size={22} className="text-white/80" />
            }
          </button>

          {/* End call button */}
          <button
            onClick={handleClose}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              boxShadow: '0 8px 30px rgba(239,68,68,0.3)',
            }}
            aria-label="Səs rejimini bitir"
          >
            <Phone size={24} className="text-white rotate-[135deg]" />
          </button>

          {/* Speaker button */}
          <button
            onClick={toggleSpeaker}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
            style={{
              background: isSpeakerOff ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.08)',
              border: isSpeakerOff ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.1)',
            }}
            aria-label={isSpeakerOff ? 'Dinamiki aç' : 'Dinamiki söndür'}
          >
            {isSpeakerOff
              ? <VolumeX size={22} className="text-red-400" />
              : <Volume2 size={22} className="text-white/80" />
            }
          </button>
        </div>

        {/* State label */}
        <p className="text-center mt-5 text-white/40 text-xs tracking-wider uppercase">
          {state === 'listening' && !isMuted && 'Dinləyir'}
          {state === 'listening' && isMuted && 'Mute'}
          {state === 'processing' && 'Cavab hazırlanır'}
          {state === 'speaking' && 'Danışır — kəsmək üçün toxunun'}
          {state === 'idle' && isMuted && 'Mikrofon söndürülüb'}
          {state === 'idle' && !isMuted && 'Danışmağa başlayın'}
        </p>
      </div>

      {/* Keyframe animation */}
      <style>{`
        @keyframes orb-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
