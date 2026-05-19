import { useState, useEffect } from 'react';
import { X, Mail, Lock, User, Loader2, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { API_BASE_URL } from '../../lib/constants';

declare global {
  interface Window {
    google?: any;
  }
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: Props) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [googleLoaded, setGoogleLoaded] = useState(false);

  const { login, register, googleLogin } = useAuth();

  // Load Google Client ID from backend
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/auth/config`)
      .then(res => res.json())
      .then(data => {
        if (data.googleClientId) {
          setGoogleClientId(data.googleClientId);
        }
      })
      .catch(console.error);
  }, []);

  // Load Google Sign-In script
  useEffect(() => {
    if (!googleClientId) return;

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleLoaded(true);
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [googleClientId]);

  // Initialize Google Sign-In button
  useEffect(() => {
    if (!googleLoaded || !googleClientId || !window.google) return;

    try {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleResponse,
      });

      window.google.accounts.id.renderButton(
        document.getElementById('google-signin-button'),
        {
          theme: 'outline',
          size: 'large',
          width: '100%',
          text: 'signin_with',
          locale: 'az',
        }
      );
    } catch (err) {
      console.error('Google Sign-In initialization error:', err);
    }
  }, [googleLoaded, googleClientId]);

  const handleGoogleResponse = async (response: any) => {
    setLoading(true);
    setError(null);
    try {
      await googleLogin(response.credential);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isLogin) await login(email, password);
      else await register(email, password, name);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-hover)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 12px 12px 40px',
    fontSize: '14px',
    outline: 'none',
    color: 'var(--fg-main)',
    minHeight: '44px',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl p-6 sm:p-8 animate-scale-in"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-md transition-colors"
          style={{ color: 'var(--fg-muted)', minHeight: '44px', minWidth: '44px' }}
          aria-label="Bağla"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div
            className="w-14 h-14 rounded-xl mx-auto flex items-center justify-center mb-4"
            style={{ background: 'var(--color-accent)' }}
          >
            <ShieldCheck size={28} className="text-white" />
          </div>
          <h2 id="auth-title" className="text-xl font-bold" style={{ color: 'var(--fg-main)' }}>
            {isLogin ? 'Xoş gəlmisiniz' : 'Hesab yarat'}
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--fg-muted)' }}>
            {isLogin ? 'bahAI-ya daxil olun' : 'bahAI ilə başlayın'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div
            className="mb-4 p-3 rounded-lg flex items-center gap-2 text-sm animate-in"
            style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171' }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Google Sign-In */}
        {googleClientId && (
          <div className="mb-4">
            <div id="google-signin-button" className="w-full flex justify-center"></div>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full" style={{ borderTop: '1px solid var(--border)' }}></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2" style={{ background: 'var(--bg-elevated)', color: 'var(--fg-muted)' }}>
                  və ya e-poçt ilə
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {!isLogin && (
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ad Soyad"
                style={inputStyle}
                aria-label="Ad Soyad"
              />
            </div>
          )}
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="E-poçt ünvanı"
              style={inputStyle}
              aria-label="E-poçt ünvanı"
            />
          </div>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Şifrə"
              minLength={8}
              style={inputStyle}
              aria-label="Şifrə"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-1"
              style={{ color: 'var(--fg-muted)' }}
            >
              {showPassword ? 'Gizlə' : 'Göstər'}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--fg-on-accent)',
              opacity: loading ? 0.7 : 1,
              minHeight: '48px',
            }}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : (isLogin ? 'Daxil ol' : 'Qeydiyyat')}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

        {/* Toggle login/register */}
        <div className="mt-5 text-center">
          <button
            onClick={() => { setIsLogin(!isLogin); setError(null); }}
            className="text-sm"
            style={{ color: 'var(--fg-muted)' }}
          >
            {isLogin ? 'Hesabınız yoxdur? ' : 'Artıq hesabınız var? '}
            <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>
              {isLogin ? 'Qeydiyyat' : 'Daxil ol'}
            </span>
          </button>
        </div>

        {/* Footer */}
        <div className="mt-5 pt-4 text-center" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            Davam etməklə İstifadə Şərtlərimizə razılaşırsınız
          </p>
        </div>
      </div>
    </div>
  );
}
