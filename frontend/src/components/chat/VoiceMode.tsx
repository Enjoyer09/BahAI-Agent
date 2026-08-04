// ==========================================
// Voice Mode — Full duplex voice chat
// ==========================================
// STT: Web Speech API (browser-native, free)
// TTS: Fish Audio S2.1 Pro Free (via /api/tts proxy)
// Flow: user speaks → transcript → chat API → response → TTS → audio playback → loop

import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, X, Volume2 } from 'lucide-react';

interface Props {
  onSend: (text: string) => void;
  onClose: () => void;
  lastAssistantMessage?: string;
  isLoading: boolean;
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

// Check if Web Speech API is available
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const speechSupported = Boolean(SpeechRecognition);

export default function VoiceMode({ onSend, onClose, lastAssistantMessage, isLoading }: Props) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevAssistantRef = useRef<string>('');
  const autoListenRef = useRef(false);

  // Start listening
  const startListening = useCallback(() => {
    if (!speechSupported) {
      setError('Bu brauzer səs tanıma dəstəkləmir. Chrome istifadə edin.');
      return;
    }

    setError(null);
    setTranscript('');

    const recognition = new SpeechRecognition();
    // Chrome mobile-da az-AZ dəstəklənmir (service-not-allowed xətası verir).
    // tr-TR (türk dili) fonetik olaraq Azərbaycan dilinə ən yaxındır və
    // Chrome-un speech recognition service-ində tam dəstəklənir.
    recognition.lang = 'tr-TR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setState('listening');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(final || interim);
    };

    recognition.onend = () => {
      const currentTranscript = recognitionRef.current?._finalTranscript;
      if (currentTranscript && currentTranscript.trim().length > 0) {
        setState('processing');
        onSend(currentTranscript.trim());
      } else {
        setState('idle');
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        setState('idle');
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Mikrofon icazəsi verilmədi və ya səs tanıma xidməti əlçatan deyil. HTTPS üzərindən Chrome istifadə edin.');
      } else if (event.error === 'network') {
        setError('Səs tanıma üçün internet bağlantısı lazımdır.');
      } else if (event.error === 'aborted') {
        // User cancelled — silent
      } else {
        setError(`Səs tanıma xətası: ${event.error}`);
      }
      setState('idle');
    };

    // Track final transcript for onend
    recognition._finalTranscript = '';
    const origOnResult = recognition.onresult;
    recognition.onresult = (event: any) => {
      let final = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        }
      }
      recognition._finalTranscript = final;
      origOnResult(event);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [onSend]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  // Speak text via Fish Audio TTS
  const speak = useCallback(async (text: string) => {
    if (!text || text.length === 0) return;

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
        throw new Error(`TTS failed: ${response.status}`);
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
        // Auto-listen after response finishes
        if (autoListenRef.current) {
          setTimeout(startListening, 300);
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setState('idle');
      };

      await audio.play();
    } catch (err) {
      console.error('[VoiceMode] TTS error:', err);
      setState('idle');
      // Still auto-listen even if TTS fails
      if (autoListenRef.current) {
        setTimeout(startListening, 300);
      }
    }
  }, [startListening]);

  // Watch for new assistant messages and speak them
  useEffect(() => {
    if (!lastAssistantMessage) return;
    if (lastAssistantMessage === prevAssistantRef.current) return;
    if (isLoading) return; // Wait until response is complete

    prevAssistantRef.current = lastAssistantMessage;

    // Voice Mode açıq olduğu müddətcə hər yeni cavab səsləndirilir
    // Strip markdown formatting for cleaner speech
    const cleanText = lastAssistantMessage
      .replace(/```[\s\S]*?```/g, ' kod bloku ')
      .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();

    if (cleanText.length > 0) {
      speak(cleanText);
    }
  }, [lastAssistantMessage, isLoading, speak]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, [stopListening]);

  const handleMicClick = () => {
    if (state === 'listening') {
      stopListening();
    } else if (state === 'idle') {
      autoListenRef.current = true;
      startListening();
    }
  };

  // Voice Mode açıldığında avtomatik dinləməyə başla
  useEffect(() => {
    autoListenRef.current = true;
    startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    autoListenRef.current = false;
    stopListening();
    if (audioRef.current) {
      audioRef.current.pause();
    }
    onClose();
  };

  const stateLabel: Record<VoiceState, string> = {
    idle: 'Mikrofona toxunun',
    listening: 'Dinlənir...',
    processing: 'Düşünür...',
    speaking: 'Danışır...',
  };

  if (!speechSupported) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="text-center p-8">
          <p className="text-white text-lg mb-4">Səs rejimi bu brauzerdə dəstəklənmir</p>
          <p className="text-white/60 text-sm mb-6">Chrome və ya Edge istifadə edin</p>
          <button onClick={onClose} className="px-4 py-2 bg-white/10 rounded-lg text-white">
            Bağla
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md">
      {/* Close button */}
      <button
        onClick={handleClose}
        className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        aria-label="Səs rejimini bağla"
      >
        <X size={24} className="text-white" />
      </button>

      {/* State indicator */}
      <p className="text-white/70 text-sm mb-8 tracking-wide uppercase">
        {stateLabel[state]}
      </p>

      {/* Central orb */}
      <div className="relative mb-8">
        <button
          onClick={handleMicClick}
          disabled={state === 'processing' || state === 'speaking'}
          className="relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300"
          style={{
            background: state === 'listening'
              ? 'radial-gradient(circle, rgba(239,68,68,0.9), rgba(239,68,68,0.5))'
              : state === 'speaking'
              ? 'radial-gradient(circle, rgba(16,163,127,0.9), rgba(16,163,127,0.5))'
              : 'radial-gradient(circle, rgba(255,255,255,0.15), rgba(255,255,255,0.05))',
            boxShadow: state === 'listening'
              ? '0 0 60px rgba(239,68,68,0.4), 0 0 120px rgba(239,68,68,0.2)'
              : state === 'speaking'
              ? '0 0 60px rgba(16,163,127,0.4), 0 0 120px rgba(16,163,127,0.2)'
              : '0 0 40px rgba(255,255,255,0.1)',
          }}
          aria-label={state === 'listening' ? 'Dinləməni dayandır' : 'Dinləməyə başla'}
        >
          {state === 'speaking' ? (
            <Volume2 size={40} className="text-white animate-pulse" />
          ) : state === 'listening' ? (
            <MicOff size={40} className="text-white" />
          ) : (
            <Mic size={40} className="text-white" />
          )}

          {/* Pulse ring for listening */}
          {state === 'listening' && (
            <span className="absolute inset-0 rounded-full animate-ping opacity-20 bg-red-500" />
          )}
        </button>
      </div>

      {/* Transcript display */}
      {transcript && (
        <div className="max-w-md px-6 text-center">
          <p className="text-white/90 text-lg leading-relaxed">{transcript}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="max-w-md px-6 mt-4 text-center">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Hint */}
      <p className="absolute bottom-8 text-white/40 text-xs">
        ESC ilə bağlayın
      </p>
    </div>
  );
}

export { speechSupported };
