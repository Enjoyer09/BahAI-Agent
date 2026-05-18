import { useState, useEffect, useRef } from 'react';
import { X, Mail, Lock, User, Github, Loader2, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../common/Toast';
import { API_BASE_URL } from '../../lib/constants';

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
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement>(null);
  const { login, googleLogin, register } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE_URL}/api/auth/config`)
      .then(res => res.json())
      .then(data => { if (data.googleClientId) setGoogleClientId(data.googleClientId); })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !googleClientId) return;
    let retryCount = 0;
    const maxRetries = 50; // 5 seconds max

    const initGoogle = () => {
      if ((window as any).google?.accounts?.id) {
        (window as any).google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response: any) => {
            setLoading(true);
            setError(null);
            try {
              await googleLogin(response.credential);
              onClose();
            } catch (err: any) {
              setError(err.message || 'Google login failed');
            } finally {
              setLoading(false);
            }
          }
        });

        if (googleBtnRef.current) {
          (window as any).google.accounts.id.renderButton(
            googleBtnRef.current,
            { theme: 'outline', size: 'large', type: 'standard', shape: 'rectangular', text: 'signin_with', width: '100%' }
          );
        }
      } else if (retryCount < maxRetries) {
        retryCount++;
        setTimeout(initGoogle, 100);
      }
    };

    initGoogle();
  }, [isOpen, googleClientId, googleLogin, onClose]);

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
    padding: '10px 12px 10px 38px',
    fontSize: '13px',
    outline: 'none',
    color: 'var(--fg-main)',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl p-6 animate-scale-in"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-md transition-colors"
          style={{ color: 'var(--fg-muted)' }}
          aria-label="Close"
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div
            className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center mb-4"
            style={{ background: 'var(--color-accent)' }}
          >
            <ShieldCheck size={24} className="text-white" />
          </div>
          <h2 id="auth-title" className="text-lg font-semibold" style={{ color: 'var(--fg-main)' }}>
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--fg-muted)' }}>
            {isLogin ? 'Sign in to bahAI' : 'Get started with bahAI'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div
            className="mb-4 p-3 rounded-lg flex items-center gap-2 text-xs animate-in"
            style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171' }}
          >
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Social auth */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => toast.info('GitHub login coming soon')}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--fg-secondary)' }}
          >
            <Github size={14} /> GitHub
          </button>
          {googleClientId ? (
            <div ref={googleBtnRef} className="flex justify-center overflow-hidden rounded-lg" />
          ) : (
            <button
              disabled
              className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--fg-muted)', opacity: 0.5 }}
            >
              Google
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full" style={{ borderTop: '1px solid var(--border)' }} />
          </div>
          <div className="relative flex justify-center">
            <span className="px-3 text-[10px] uppercase" style={{ background: 'var(--bg-elevated)', color: 'var(--fg-muted)' }}>
              or
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {!isLogin && (
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Full name"
                style={inputStyle}
                aria-label="Full name"
              />
            </div>
          )}
          <div className="relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email address"
              style={inputStyle}
              aria-label="Email address"
            />
          </div>
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              style={inputStyle}
              aria-label="Password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px]"
              style={{ color: 'var(--fg-muted)' }}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--fg-on-accent)',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : (isLogin ? 'Sign In' : 'Create Account')}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        {/* Toggle login/register */}
        <div className="mt-4 text-center">
          <button
            onClick={() => { setIsLogin(!isLogin); setError(null); }}
            className="text-xs"
            style={{ color: 'var(--fg-muted)' }}
          >
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <span style={{ color: 'var(--color-accent)' }}>
              {isLogin ? 'Sign up' : 'Sign in'}
            </span>
          </button>
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 text-center" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            By continuing, you agree to our Terms of Service
          </p>
        </div>
      </div>
    </div>
  );
}
