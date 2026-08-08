// ==========================================
// Voice Mode — Push-to-Talk (ChatGPT style)
// ==========================================
// Orba bir dəfə bas → dinləyir (mavi)
// Bir daha bas → göndərir (bənövşəyi düşünür)
// Cavab gəlir → səsləndirir (yaşıl danışır)
// Audio bitir → idle (boz, yenidən basa bilərsən)
//
// STT: server-side /api/stt (MediaRecorder) + Web Speech API fallback (az-AZ)
// TTS: Fish Audio S2.1 Pro Free

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

// Server-side STT path (MediaRecorder + /api/stt). Works on all modern browsers
// including Safari/Firefox where the Web Speech API is unreliable or absent.
export const mediaRecordingSupported =
  typeof navigator !== 'undefined' &&
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
  typeof (window as any).MediaRecorder !== 'undefined';

export default function VoiceMode({ onSend, onClose, lastAssistantMessage, isLoading }: Props) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const prevAssistantRef = useRef<string>('');
  const activeRef = useRef(true);
  const speakerOffRef = useRef(false);

  // Server STT (MediaRecorder) capture refs
  const mediaRecorderRef = useRef<any>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const wsFinalRef = useRef<string>(''); // Web Speech final transcript (fallback)
  const usingServerSttRef = useRef<boolean>(false);

  useEffect(() => { speakerOffRef.current = isSpeakerOff; }, [isSpeakerOff]);

  // ── Shared audio element (reused across all TTS plays) ──
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const getAudioEl = useCallback(() => {
    if (!audioElRef.current) {
      audioElRef.current = new Audio();
    }
    return audioElRef.current;
  }, []);

  // ── Audio unlock (mobile autoplay policy) ──
  const audioUnlockedRef = useRef(false);
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    const audio = getAudioEl();
    audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    audio.volume = 0.01;
    audio.play().then(() => { audio.volume = 1; }).catch(() => { audio.volume = 1; });
  }, [getAudioEl]);

  // ── Start listening (called on orb tap) ──
  const startListening = useCallback(async () => {
    setError(null);
    setTranscript('');
    wsFinalRef.current = '';
    mediaChunksRef.current = [];
    usingServerSttRef.current = false;

    // Primary path: capture audio locally and transcribe on the server (/api/stt).
    if (mediaRecordingSupported) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        const recorder = new (window as any).MediaRecorder(stream);
        recorder.ondataavailable = (e: any) => {
          if (e.data && e.data.size > 0) mediaChunksRef.current.push(e.data);
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
        usingServerSttRef.current = true;
      } catch (e: any) {
        // Permission denied / no device / not allowed → fall back to Web Speech.
        mediaRecorderRef.current = null;
        usingServerSttRef.current = false;
      }
    }

    // Live transcript preview via Web Speech API (best-effort). Also serves as the
    // fallback transcript if server STT is unconfigured/unavailable. Language is
    // fixed to Azerbaijani (it was incorrectly set to tr-TR before).
    if (speechSupported) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = 'az-AZ';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onresult = (event: any) => {
          let interim = '';
          let final = '';
          for (let i = 0; i < event.results.length; i++) {
            if (event.results[i].isFinal) final += event.results[i][0].transcript;
            else interim += event.results[i][0].transcript;
          }
          wsFinalRef.current = final || interim;
          setTranscript(final || interim);
        };
        recognition.onerror = (event: any) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setError('Mikrofon icazəsi yoxdur. Brauzer ayarlarından icazə verin.');
          }
        };
        recognitionRef.current = recognition;
        recognition.start();
      } catch (e: any) {
        recognitionRef.current = null;
      }
    }

    setState('listening');
  }, []);

  // ── Transcribe via server STT (MediaRecorder buffer) ──
  const transcribeServer = useCallback((): Promise<string> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return Promise.resolve('');

    return new Promise<string>((resolve) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          if (!blob.size) return resolve(wsFinalRef.current);

          const fd = new FormData();
          fd.append('audio', blob, 'audio.webm');
          const token = localStorage.getItem('auth_token') || '';
          const res = await fetch('/api/stt?lang=az', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: fd,
          });

          if (!res.ok) {
            // Unconfigured or upstream error → fall back to Web Speech transcript.
            return resolve(wsFinalRef.current);
          }
          const data = await res.json().catch(() => null);
          const text = (data && data.text) || '';
          resolve(text || wsFinalRef.current);
        } catch {
          resolve(wsFinalRef.current);
        }
      };
      try { recorder.stop(); } catch { resolve(wsFinalRef.current); }
    });
  }, []);

  // ── Stop listening and send (called on second orb tap) ──
  const stopAndSend = useCallback(() => {
    // Stop the Web Speech preview/fallback recognizer.
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    const finish = (text: string) => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      mediaRecorderRef.current = null;
      const t = (text || '').trim();
      if (t) {
        setState('processing');
        setTranscript(t);
        onSend(t);
      } else {
        setState('idle');
        setTranscript('');
      }
    };

    if (usingServerSttRef.current && mediaRecorderRef.current) {
      setState('processing');
      transcribeServer().then(finish).catch(() => finish(wsFinalRef.current));
    } else {
      finish(wsFinalRef.current);
    }
  }, [onSend, transcribeServer]);

  // ── TTS ──
  // Use a SINGLE audio element for the lifetime of VoiceMode. Mobile browsers
  // allow .play() on an element that was previously played via user gesture —
  // creating a new Audio() each time loses that "trusted" status.
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

      const audio = getAudioEl();
      // Revoke previous blob URL if any
      if (audio.src && audio.src.startsWith('blob:')) {
        URL.revokeObjectURL(audio.src);
      }
      audio.src = url;

      audio.onended = () => {
        setState('idle');
      };

      audio.onerror = () => {
        setState('idle');
      };

      await audio.play();
    } catch (err) {
      console.error('[VoiceMode] TTS error:', err);
      setState('idle');
    }
  }, [getAudioEl]);

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
      if (mediaRecorderRef.current) { try { mediaRecorderRef.current.stop(); } catch {} mediaRecorderRef.current = null; }
      if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null; }
      const audio = audioElRef.current;
      if (audio) { audio.pause(); if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src); }
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
      const audio = audioElRef.current;
      if (audio) audio.pause();
      setState('idle');
    }
  };

  // ── Speaker toggle ──
  const toggleSpeaker = () => {
    if (isSpeakerOff) {
      setIsSpeakerOff(false);
    } else {
      setIsSpeakerOff(true);
      const audio = audioElRef.current;
      if (audio && state === 'speaking') {
        audio.pause();
        setState('idle');
      }
    }
  };

  // ── End call ──
  const handleClose = () => {
    activeRef.current = false;
    if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} }
    if (mediaRecorderRef.current) { try { mediaRecorderRef.current.stop(); } catch {} mediaRecorderRef.current = null; }
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null; }
    const audio = audioElRef.current;
    if (audio) audio.pause();
    onClose();
  };

  if (!speechSupported && !mediaRecordingSupported) {
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
