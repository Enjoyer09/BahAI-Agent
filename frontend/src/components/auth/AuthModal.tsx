// ==========================================
// AuthModal — Integrated with Custom Backend
// ==========================================

import { useState } from 'react';
import { X, Mail, Lock, User, Github, Loader2, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const { login, register } = useAuth();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-2xl bg-black/40 animate-in fade-in duration-500">
      <div className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-[2.5rem] shadow-[0_50px_100px_rgba(0,0,0,0.8)] overflow-hidden relative">
        
        <button onClick={onClose} className="absolute top-6 right-6 p-2 hover:bg-white/5 rounded-xl transition-colors text-gray-500 hover:text-white">
          <X size={20} />
        </button>

        <div className="p-10">
          <div className="text-center mb-10 space-y-3">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center shadow-2xl shadow-blue-600/40 mb-6">
              <ShieldCheck size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white">
              {isLogin ? 'Xoş Gəldiniz' : 'Hesab Yaradın'}
            </h2>
            <p className="text-xs text-gray-500 font-medium">
              {isLogin ? 'bahAI dünyasına daxil olun' : 'Asistentinizi fərdiləşdirmək üçün qeydiyyatdan keçin'}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-500 text-[11px] animate-in shake duration-300">
              <AlertCircle size={16} />
              <p>{error}</p>
            </div>
          )}

          {/* Social Auth */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button 
              onClick={() => alert('GitHub girişi tezliklə aktiv olacaq!')}
              className="flex items-center justify-center gap-3 px-4 py-3 bg-white/5 border border-white/5 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 hover:border-white/10 transition-all active:scale-95"
            >
              <Github size={16} /> GitHub
            </button>
            <button 
              onClick={() => alert('Google girişi tezliklə aktiv olacaq!')}
              className="flex items-center justify-center gap-3 px-4 py-3 bg-white/5 border border-white/5 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 hover:border-white/10 transition-all active:scale-95"
            >
              Google
            </button>
          </div>

          <div className="relative mb-8 text-center">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
            <span className="relative bg-[#0a0a0c] px-4 text-[9px] font-black uppercase tracking-widest text-gray-600">və ya email ilə</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="relative group">
                <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-blue-500 transition-colors" />
                <input 
                  type="text" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="Adınız və Soyadınız" 
                  className="w-full bg-white/5 border border-white/5 rounded-2xl px-12 py-4 text-xs focus:outline-none focus:border-blue-500/50 transition-all"
                />
              </div>
            )}
            <div className="relative group">
              <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-blue-500 transition-colors" />
              <input 
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="Email Ünvanı" 
                className="w-full bg-white/5 border border-white/5 rounded-2xl px-12 py-4 text-xs focus:outline-none focus:border-blue-500/50 transition-all"
              />
            </div>
            <div className="relative group">
              <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-blue-500 transition-colors" />
              <input 
                type="password" required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Şifrə" 
                className="w-full bg-white/5 border border-white/5 rounded-2xl px-12 py-4 text-xs focus:outline-none focus:border-blue-500/50 transition-all"
              />
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl shadow-blue-600/40 transition-all active:scale-95 flex items-center justify-center gap-3 mt-4"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : (isLogin ? 'Daxil Ol' : 'Qeydiyyatdan Keç')}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="mt-8 text-center">
            <button 
              onClick={() => setIsLogin(!isLogin)}
              className="text-[10px] font-bold text-gray-500 hover:text-blue-400 transition-colors"
            >
              {isLogin ? 'Hələ hesabınız yoxdur? Qeydiyyatdan keçin' : 'Artıq hesabınız var? Daxil olun'}
            </button>
          </div>
        </div>

        <div className="bg-white/[0.02] border-t border-white/5 p-6 text-center">
           <p className="text-[9px] text-gray-600 uppercase tracking-widest leading-relaxed">
             Daxil olmaqla siz iBahora <span className="text-gray-400 underline cursor-pointer">Xidmət Şərtləri</span> ilə razılaşırsınız.
           </p>
        </div>
      </div>
    </div>
  );
}
