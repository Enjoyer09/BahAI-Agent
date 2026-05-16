// ==========================================
// AuthModal — Premium Login & Register View
// ==========================================

import { useState } from 'react';
import { X, Mail, Lock, User, Github, Loader2, ShieldCheck, ArrowRight } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // TODO: Integrate with Supabase
    setTimeout(() => {
      setLoading(false);
      alert(isLogin ? 'Giriş uğurludur (Demo)' : 'Qeydiyyat uğurludur (Demo)');
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-2xl bg-black/40 animate-in fade-in duration-500">
      <div className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-[2.5rem] shadow-[0_50px_100px_rgba(0,0,0,0.8)] overflow-hidden relative">
        
        {/* Close Button */}
        <button onClick={onClose} className="absolute top-6 right-6 p-2 hover:bg-white/5 rounded-xl transition-colors text-gray-500 hover:text-white">
          <X size={20} />
        </button>

        <div className="p-10">
          {/* Header */}
          <div className="text-center mb-10 space-y-3">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center shadow-2xl shadow-blue-600/40 mb-6">
              <ShieldCheck size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white">
              {isLogin ? 'Xoş Gəldiniz' : 'Hesab Yaradın'}
            </h2>
            <p className="text-xs text-gray-500 font-medium">
              {isLogin ? 'iBahora Code dünyasına daxil olun' : 'Agentinizi fərdiləşdirmək üçün qeydiyyatdan keçin'}
            </p>
          </div>

          {/* Social Auth */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button className="flex items-center justify-center gap-3 px-4 py-3 bg-white/5 border border-white/5 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95">
              <Github size={16} /> GitHub
            </button>
            <button className="flex items-center justify-center gap-3 px-4 py-3 bg-white/5 border border-white/5 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95">
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg> Google
            </button>
          </div>

          <div className="relative mb-8 text-center">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
            <span className="relative bg-[#0a0a0c] px-4 text-[9px] font-black uppercase tracking-widest text-gray-600">və ya email ilə</span>
          </div>

          {/* Form */}
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

          {/* Toggle */}
          <div className="mt-8 text-center">
            <button 
              onClick={() => setIsLogin(!isLogin)}
              className="text-[10px] font-bold text-gray-500 hover:text-blue-400 transition-colors"
            >
              {isLogin ? 'Hələ hesabınız yoxdur? Qeydiyyatdan keçin' : 'Artıq hesabınız var? Daxil olun'}
            </button>
          </div>
        </div>

        {/* Footer info */}
        <div className="bg-white/[0.02] border-t border-white/5 p-6 text-center">
           <p className="text-[9px] text-gray-600 uppercase tracking-widest leading-relaxed">
             Daxil olmaqla siz iBahora <span className="text-gray-400 underline cursor-pointer">Xidmət Şərtləri</span> ilə razılaşırsınız.
           </p>
        </div>
      </div>
    </div>
  );
}
