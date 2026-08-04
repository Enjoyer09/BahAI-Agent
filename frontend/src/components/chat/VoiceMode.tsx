// ==========================================
// Voice Mode — Push-to-Talk (ChatGPT style)
// ==========================================
// Orba bir dəfə bas → dinləyir (mavi)
// Bir daha bas → göndərir (bənövşəyi düşünür)
// Cavab gəlir → səsləndirir (yaşıl danışır)
// Audio bitir → idle (boz, yenidən basa bilərsən)
//
// STT: Web Speech API (tr-TR) | TTS: Fish Audio S2.1 Pro Free

import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Phone } from 'lucide-react';

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
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevAssistantRef = useRef<string>('');
  const activeRef = useRef(true);
  const speakerOffRef = useRef(false);

  useEffect(() => { speakerOffRef.current = isSpeakerOff; }, [isSpeakerOff]);

  // ── Audio unlock (mobile autoplay policy) ──
  // Mobile Chrome blocks audio.play() without a recent user gesture. We play a
  // silent clip on the first orb tap to "warm" the audio pipeline — after that,
  // programmatic play() calls succeed for the life of the page.
  const audioUnlockedRef = useRef(false);
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    // Play a tiny silent WAV to unlock the audio output
    const silence = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    const a = new Audio(silence);
    a.volume = 0;
    a.play().catch(() => {});
  }, []);

  // ── Start listening (called on orb tap) ──
  const startListening = useCallback(() => {
    if (!speechSupported) return;
    setError(null);
    setTranscript('');

    const recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setState('listening');

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
      recognition._finalTranscript = final || interim;
    };

    recognition.onend = () => {
      // Only fires when we explicitly stop — do nothing here,
      // sending is handled by stopAndSend()
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Mikrofon icazəsi yoxdur. Brauzer ayarlarından icazə verin.');
      } else if (event.error === 'network') {
        setError('İnternet bağlantısı lazımdır.');
      } else {
        setError(`Xəta: ${event.error}`);
      }
      setState('idle');
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e: any) {
      setError(`Mikrofon açılmadı: ${e?.message || ''}`);
      setState('idle');
    }
  }, []);

  // ── Stop listening and send (called on second orb tap) ──
  const stopAndSend = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    const text = (recognition._finalTranscript || '').trim();
    try { recognition.stop(); } catch {}
    recognitionRef.current = null;

    if (text.length > 0) {
      setState('processing');
      setTranscript(text);
      onSend(text);
    } else {
      setState('idle');
      setTranscript('');
    }
  }, [onSend]);

  // ── TTS ──
  const speak = useCallback(async (text: string) => {
    if (!text || speakerOffRef.current) {
      setState('idle');
      return;
    }

    setState('speaking');
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
        body: JSON.stringify({ text: text.slice(0, 4000) }),
      });

      if (!response.ok) throw new Error(`TTS: ${response.status}`);

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
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setState('idle');
      };

      await audio.play();
    } catch (err) {
      console.error('[VoiceMode] TTS error:', err);
      setState('idle');
    }
  }, []);

  // ── Watch for assistant response → speak it ──
  // On mount, snapshot the current assistant message so we only speak NEW ones.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      // First render — record the existing assistant message so we don't speak it
      mountedRef.current = true;
      if (lastAssistantMessage) {
        prevAssistantRef.current = lastAssistantMessage;
      }
      return;
    }
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

    if (cleanText.length > 0) speak(cleanText);
  }, [lastAssistantMessage, isLoading, speak]);

  // ── Cleanup ──
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} }
      if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
    };
  }, []);

  // ── ESC to close ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Orb tap — the main interaction ──
  const handleOrbTap = () => {
    unlockAudio();
    if (state === 'idle') {
      startListening();
    } else if (state === 'listening') {
      stopAndSend();
    } else if (state === 'speaking') {
      // Interrupt playback
      if (audioRef.current) audioRef.current.pause();
      setState('idle');
    }
  };

  // ── Speaker toggle ──
  const toggleSpeaker = () => {
    if (isSpeakerOff) {
      setIsSpeakerOff(false);
    } else {
      setIsSpeakerOff(true);
      if (audioRef.current && state === 'speaking') {
        audioRef.current.pause();
        setState('idle');
      }
    }
  };

  // ── End call ──
  const handleClose = () => {
    activeRef.current = false;
    if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} }
    if (audioRef.current) audioRef.current.pause();
    onClose();
  };

  if (!speechSupported) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
        <div className="text-center p-8">
          <p className="text-white text-lg mb-4">Bu brauzer səs rejimini dəstəkləmir</p>
          <p className="text-white/50 text-sm mb-6">Chrome və ya Edge istifadə edin</p>
          <button onClick={onClose} className="px-5 py-2.5 bg-white/10 rounded-full text-white text-sm hover:bg-white/20 transition">Bağla</button>
        </div>
      </div>
    );
  }

  const stateConfig = {
    idle: { label: 'Danışmaq üçün toxunun', gradient: 'radial-gradient(circle at 35% 35%, #6b7280, #374151, #1f2937)', glow: '0 0 40px rgba(0,0,0,0.3)', ring: null },
    listening: { label: 'Dinləyir... Göndərmək üçün toxunun', gradient: 'radial-gradient(circle at 35% 35%, #60b5ff, #2563eb, #1e40af)', glow: '0 0 80px rgba(37,99,235,0.4)', ring: 'bg-blue-400' },
    processing: { label: 'Düşünür...', gradient: 'radial-gradient(circle at 35% 35%, #c4a5ff, #7c3aed, #4c1d95)', glow: '0 0 60px rgba(124,58,237,0.3)', ring: null },
    speaking: { label: 'Danışır — kəsmək üçün toxunun', gradient: 'radial-gradient(circle at 35% 35%, #4eeac0, #10a37f, #065f46)', glow: '0 0 80px rgba(16,163,127,0.4)', ring: 'bg-emerald-400' },
  };

  const cfg = stateConfig[state];

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#0d0d0f] select-none">
      {/* ── Top: transcript ── */}
      <div className="flex-shrink-0 pt-16 px-6 text-center max-w-lg w-full min-h-[80px]">
        {transcript && (state === 'listening' || state === 'processing') && (
          <p className="text-white/80 text-base leading-relaxed">{transcript}</p>
        )}
        {error && <p className="text-red-400/90 text-sm mt-2">{error}</p>}
      </div>

      {/* ── Center: Orb (main button) ── */}
      <div className="flex-1 flex items-center justify-center">
        <button
          onClick={handleOrbTap}
          disabled={state === 'processing'}
          className="relative focus:outline-none active:scale-95 transition-transform"
          aria-label={cfg.label}
        >
          {/* Glow */}
          <div className="absolute inset-0 rounded-full transition-all duration-700" style={{ transform: 'scale(1.5)', background: state === 'listening' ? 'radial-gradient(circle, rgba(99,179,255,0.12), transparent 70%)' : state === 'speaking' ? 'radial-gradient(circle, rgba(16,163,127,0.12), transparent 70%)' : 'transparent' }} />

          {/* Ping ring */}
          {cfg.ring && <div className={`absolute inset-0 rounded-full animate-ping opacity-15 ${cfg.ring}`} style={{ animationDuration: '2s' }} />}

          {/* Orb */}
          <div
            className="relative w-40 h-40 sm:w-48 sm:h-48 rounded-full transition-all duration-500 flex items-center justify-center"
            style={{ background: cfg.gradient, boxShadow: `${cfg.glow}, inset 0 -20px 40px rgba(0,0,0,0.3)`, animation: state === 'speaking' ? 'orb-breathe 2s ease-in-out infinite' : undefined }}
          >
            {/* Inner highlight */}
            <div className="absolute top-[15%] left-[20%] w-[28%] h-[28%] rounded-full opacity-40" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.6), transparent)' }} />

            {/* Icon inside orb */}
            {state === 'idle' && <Mic size={36} className="text-white/70" />}
            {state === 'listening' && <Mic size={36} className="text-white animate-pulse" />}
            {state === 'processing' && (
              <div className="flex gap-1.5">
                {[0,1,2].map(i => <div key={i} className="w-2.5 h-2.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />)}
              </div>
            )}
            {state === 'speaking' && <Volume2 size={36} className="text-white" />}
          </div>
        </button>
      </div>

      {/* ── Bottom: Controls ── */}
      <div className="flex-shrink-0 pb-12 sm:pb-16 px-6 w-full max-w-xs">
        <div className="flex items-center justify-between">
          {/* Speaker toggle */}
          <button
            onClick={toggleSpeaker}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all"
            style={{ background: isSpeakerOff ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.08)', border: isSpeakerOff ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.1)' }}
            aria-label={isSpeakerOff ? 'Dinamiki aç' : 'Dinamiki söndür'}
          >
            {isSpeakerOff ? <VolumeX size={20} className="text-red-400" /> : <Volume2 size={20} className="text-white/70" />}
          </button>

          {/* End call */}
          <button
            onClick={handleClose}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
            style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 8px 24px rgba(239,68,68,0.3)' }}
            aria-label="Bitir"
          >
            <Phone size={22} className="text-white rotate-[135deg]" />
          </button>

          {/* Placeholder for symmetry */}
          <div className="w-12 h-12" />
        </div>

        {/* State label */}
        <p className="text-center mt-5 text-white/40 text-xs tracking-wider uppercase">{cfg.label}</p>
      </div>

      <style>{`
        @keyframes orb-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
      `}</style>
    </div>
  );
}
