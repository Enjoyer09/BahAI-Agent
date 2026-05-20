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

  const { login, register } = useAuth();

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

  // Listen for OAuth callback message (from popup window)
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'google-oauth-credential' && event.data?.token) {
        setLoading(true);
        setError(null);
        try {
          // Token already created by backend, just save it
          localStorage.removeItem('signed_out');
          localStorage.setItem('auth_token', event.data.token);
          // Reload to pick up the new session
          window.location.reload();
        } catch (err: any) {
          setError(err.message);
          setLoading(false);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onClose]);

  const handleGoogleSignIn = () => {
    if (!googleClientId) return;
    // Open Google OAuth in a popup window (works in Electron)
    const redirectUri = `${API_BASE_URL}/api/auth/google-callback`;
    const scope = 'openid email profile';
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&prompt=select_account`;
    
    const width = 500, height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open(url, 'google-oauth', `width=${width},height=${height},left=${left},top=${top}`);
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
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 rounded-xl text-sm font-medium transition-all border"
              style={{
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                color: 'var(--fg-main)',
                minHeight: '48px',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google ilə daxil ol
            </button>
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
