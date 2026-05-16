// ==========================================
// LandingPage — Premium SaaS Entrance
// ==========================================

import { useEffect, useState } from 'react';
import { ArrowRight, Zap, Code2, Cpu, Globe, Rocket, ChevronDown, CheckCircle2 } from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const features = [
    { icon: <Code2 className="text-blue-400" />, title: 'Avtonom Kodlaşdırma', desc: 'Sizin üçün faylları yaradır, redaktə edir və layihəni sıfırdan qurur.' },
    { icon: <Cpu className="text-purple-400" />, title: 'Yerli Kod Asistenti', desc: 'Məlumatlarınızın təhlükəsizliyi üçün özəl serverlərdə işləyən daxili AI modelləri.' },
    { icon: <Globe className="text-emerald-400" />, title: 'Canlı Önizləmə', desc: 'Yazılan kodu anında brauzerdə görün və real vaxtda test edin.' },
    { icon: <Rocket className="text-orange-400" />, title: 'Sürətli Deployment', desc: 'Layihənizi tək kliklə GitHub və Railway-ə göndərin.' }
  ];

  const steps = [
    { num: '01', title: 'İdeyanı Yaz', desc: 'Nə yaratmaq istədiyinizi sadə dildə (məs: "Bir POS sistemi qur") agentə bildirin.' },
    { num: '02', title: 'Agent İcra Edir', desc: 'bahAI bütün faylları yaradır, lazımi kitabxanaları quraşdırır və kodu yazır.' },
    { num: '03', title: 'Canlıya Çıx', desc: 'Nəticəni dərhal yoxlayın və tək düymə ilə dünyada yayımlayın.' }
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-blue-500/30 overflow-x-hidden font-sans scroll-smooth">
      
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-purple-600/10 rounded-full blur-[100px] delay-1000" />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 h-20 flex items-center justify-between px-8 md:px-20 z-50 backdrop-blur-md bg-black/20 border-b border-white/5">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="bahAI" className="w-10 h-10 rounded-xl shadow-lg shadow-blue-600/20" />
          <span className="text-2xl font-black tracking-tighter uppercase">bah<span className="text-blue-500">AI</span></span>
        </div>
        <div className="hidden md:flex items-center gap-10 text-sm font-medium text-gray-400">
          <a href="#features" className="hover:text-white transition-colors">Xüsusiyyətlər</a>
          <a href="#how-it-works" className="hover:text-white transition-colors">Necə İşləyir?</a>
          <a href="#pricing" className="hover:text-white transition-colors">Qiymət</a>
        </div>
        <button 
          onClick={onGetStarted}
          className="px-6 py-2.5 bg-white text-black text-sm font-bold rounded-full hover:bg-blue-500 hover:text-white transition-all duration-500 active:scale-95 shadow-xl shadow-white/5"
        >
          Giriş Et
        </button>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center pt-20 px-6 overflow-hidden">
        <div className="animate-in fade-in slide-in-from-top-4 duration-1000">
          <div className="px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-[10px] font-black uppercase tracking-[0.3em] text-blue-400 mb-8 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            PRE-BETA AKTİVDİR
          </div>
        </div>

        <h1 className="text-5xl md:text-8xl font-black text-center max-w-5xl leading-[1.1] tracking-tighter mb-8 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-200">
          Azərbaycanın ilk və tək <br/> 
          <span className="bg-gradient-to-r from-blue-400 via-purple-500 to-blue-600 bg-clip-text text-transparent underline decoration-white/10 underline-offset-8">Yerli sizin kod asistentiniz</span>
        </h1>

        <p className="text-gray-400 text-center max-w-2xl text-lg md:text-xl mb-12 animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-500">
          bahAI ilə cəmi bir neçə saniyə ərzində mürəkkəb proqram təminatları yaradın. 
          Siz sadəcə ideyanızı deyin, qalanını AI həll etsin.
        </p>

        <div className="flex flex-col md:flex-row items-center gap-6 animate-in fade-in slide-in-from-bottom-2 duration-1000 delay-700">
          <button 
            onClick={onGetStarted}
            className="group px-10 py-5 bg-blue-600 rounded-3xl font-black text-lg flex items-center gap-3 hover:bg-blue-500 transition-all duration-500 shadow-2xl shadow-blue-600/30 active:scale-95"
          >
            Pulsuz Yoxla
            <ArrowRight className="group-hover:translate-x-2 transition-transform" />
          </button>
        </div>

        <div className="absolute bottom-10 animate-bounce opacity-40">
          <ChevronDown size={32} />
        </div>
      </section>

      {/* Visual Showcase */}
      <section className="px-6 md:px-20 py-20">
        <div 
          className="relative group rounded-[3rem] overflow-hidden border border-white/5 shadow-2xl shadow-blue-600/5 aspect-video md:aspect-[21/9]"
          style={{ transform: `perspective(1000px) rotateX(${Math.max(0, 10 - scrollY/100)}deg)` }}
        >
          <img src="/landing_hero.png" alt="Showcase" className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-[2s]" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent" />
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="px-6 md:px-20 py-32 scroll-mt-24">
        <div className="mb-20 text-center">
          <h2 className="text-4xl md:text-6xl font-black mb-6">Nələr Mümkündür?</h2>
          <p className="text-gray-500 max-w-xl mx-auto">İstər veb sayt, istər mürəkkəb proqram təminatı — bahAI hər şeyi sizin üçün edə bilər.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((f, i) => (
            <div key={i} className="p-8 rounded-[2.5rem] bg-white/[0.02] border border-white/5 hover:border-blue-500/30 transition-all duration-500 group">
              <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                {f.icon}
              </div>
              <h3 className="text-xl font-bold mb-4">{f.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="px-6 md:px-20 py-32 bg-white/[0.01] border-y border-white/5 scroll-mt-24">
        <div className="mb-20 text-center">
          <h2 className="text-4xl md:text-6xl font-black mb-6">Necə İşləyir?</h2>
          <p className="text-gray-500">Sadəcə 3 addımda öz layihənizi işə salın.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {steps.map((s, i) => (
            <div key={i} className="relative p-10 rounded-[3rem] bg-black border border-white/5 shadow-inner">
              <span className="absolute top-10 right-10 text-5xl font-black text-white/5 leading-none">{s.num}</span>
              <h3 className="text-2xl font-bold mb-4 text-blue-500">{s.title}</h3>
              <p className="text-gray-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 md:px-20 py-32 scroll-mt-24">
        <div className="mb-20 text-center">
          <h2 className="text-4xl md:text-6xl font-black mb-6">Qiymətlər</h2>
          <p className="text-blue-400 font-bold tracking-widest uppercase text-sm">Beta Mərhələsi</p>
        </div>
        <div className="max-w-xl mx-auto p-12 rounded-[3.5rem] bg-gradient-to-b from-blue-600 to-blue-800 border border-blue-400/30 shadow-2xl shadow-blue-600/40 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Zap size={100} />
          </div>
          <h3 className="text-3xl font-black mb-4">Beta Test Rejimi</h3>
          <p className="text-white/80 mb-8 leading-relaxed">
            Platforma hazırda Beta sınaq mərhələsindədir. Bizim missiyamız hər kəsə kod yazmaq imkanı verməkdir.
          </p>
          <div className="text-6xl font-black mb-8 flex items-baseline justify-center gap-2">
            0 AZN <span className="text-sm font-medium text-white/50">/ həmişə</span>
          </div>
          <div className="space-y-4 mb-10 text-left">
            <div className="flex items-center gap-3"><CheckCircle2 size={18} className="text-blue-200" /> <span>Limitsiz layihə yaratmaq</span></div>
            <div className="flex items-center gap-3"><CheckCircle2 size={18} className="text-blue-200" /> <span>Bütün AI modellərinə giriş</span></div>
            <div className="flex items-center gap-3"><CheckCircle2 size={18} className="text-blue-200" /> <span>Testlər tamamilə pulsuzdur</span></div>
          </div>
          <button 
            onClick={onGetStarted}
            className="w-full py-5 bg-white text-blue-700 rounded-3xl font-black text-lg hover:scale-[1.02] active:scale-95 transition-all shadow-xl"
          >
            İndi Başla
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-20 px-8 md:px-20 bg-black/40">
        <div className="flex flex-col md:flex-row justify-between items-center gap-10">
          <div className="flex items-center gap-3 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all">
            <img src="/logo.png" alt="bahAI" className="w-8 h-8 rounded-lg" />
            <span className="text-lg font-black tracking-tighter uppercase">bahAI</span>
          </div>
          <p className="text-gray-600 text-[10px] uppercase tracking-[0.2em]">© 2026 bahAI Intelligence — Bütün hüquqlar qorunur.</p>
        </div>
      </footer>

    </div>
  );
}
