import { useEffect, useState, useRef } from 'react';
import {
  ArrowRight,
  Zap,
  Code2,
  Cpu,
  Globe,
  Rocket,
  ChevronDown,
  CheckCircle2,
  Shield,
  Sparkles,
  Bot,
  Play,
} from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
}

function AnimateIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity 0.6s ease-out ${delay}s, transform 0.6s ease-out ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

function GridDots() {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ opacity: 0.03 }}>
      <svg width="100%" height="100%">
        <defs>
          <pattern id="grid-dots" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="white" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-dots)" />
      </svg>
    </div>
  );
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const features = [
    {
      icon: <Bot size={22} />,
      title: 'Chat-First Assistant',
      desc: 'Sual verin, fikir aydınlaşdırın, plan qurun və işinizi sürətləndirin. Web təcrübə sadə və çevikdir.',
      color: '#10a37f',
    },
    {
      icon: <Globe size={22} />,
      title: 'BahAI Cloud',
      desc: 'Railway üzərində işləyən cloud assistant. Model seçimi gizlidir, routing arxa planda həll olunur.',
      color: '#3b82f6',
    },
    {
      icon: <Code2 size={22} />,
      title: 'BahAI Desktop',
      desc: 'Desktop tətbiqində Cloud və Local mənbələri ilə daha dərin kod agent təcrübəsi əldə edin.',
      color: '#8b5cf6',
    },
    {
      icon: <Shield size={22} />,
      title: 'Ağıllı Yönləndirmə',
      desc: 'İstifadəçi modeli seçmədən BahAI sorğuya uyğun cavab yolunu və provider qatını özü müəyyən edir.',
      color: '#f59e0b',
    },
    {
      icon: <Cpu size={22} />,
      title: 'Arxa Fon Model Layeri',
      desc: 'Cloud və local model qatları ayrıdır. Məhsul səthi sadə qalır, texniki seçimlər daxildə idarə olunur.',
      color: '#ec4899',
    },
    {
      icon: <Rocket size={22} />,
      title: 'Böyüyən Ekosistem',
      desc: 'GUI, SEO və orchestration imkanları desktop səthində mərhələli şəkildə genişlənir.',
      color: '#06b6d4',
    },
  ];

  const steps = [
    {
      num: '01',
      title: 'Yaz və Soruş',
      desc: 'Web-də sualını və ya iş məqsədini sadə dildə yaz. BahAI cavabı aydınlaşdırır və növbəti addımı təklif edir.',
    },
    {
      num: '02',
      title: 'BahAI Yönləndirir',
      desc: 'Sorğuya uyğun cavab, plan və ya icra yolu arxa planda seçilir. İstifadəçi əlavə sazlama ilə məşğul olmur.',
    },
    {
      num: '03',
      title: 'Daha Dərin İşə Keç',
      desc: 'Lazım olanda desktop tətbiqinə keçərək Local və ya Cloud source ilə kod agent axınlarını davam etdir.',
    },
  ];

  const stats = [
    { value: '2', label: 'MƏHSUL XƏTTİ' },
    { value: 'Cloud', label: 'CHAT-FIRST WEB' },
    { value: 'Desktop', label: 'CODE AGENT' },
  ];

  return (
    <div className="min-h-screen text-white overflow-x-hidden font-sans scroll-smooth" style={{ background: '#09090b' }}>

      {/* Navigation */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 md:px-10 h-14 md:h-16"
        style={{
          background: 'rgba(9,9,11,0.8)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative w-8 h-8 rounded-full overflow-hidden shrink-0 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.35)]">
            <img 
              src="/assets/bahar_avatar.jpg" 
              alt="Bahar Avatar" 
              className="w-full h-full object-cover object-center"
            />
          </div>
          <span className="text-base font-extrabold tracking-wide uppercase text-slate-100">
            BAH<span style={{ color: '#10b981' }}>AI</span>
          </span>
        </div>

        <div className="hidden md:flex items-center gap-8 text-sm text-zinc-400">
          <a href="#features" className="hover:text-white transition-colors">Xüsusiyyətlər</a>
          <a href="#how" className="hover:text-white transition-colors">Necə İşləyir</a>
          <a href="#pricing" className="hover:text-white transition-colors">Qiymət</a>
        </div>

        <button
          onClick={onGetStarted}
          className="flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg transition-all active:scale-[0.97]"
          style={{
            background: 'var(--color-accent)',
            color: 'white',
          }}
        >
          Daxil ol
          <ArrowRight size={14} />
        </button>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-5 md:px-10 pt-16 overflow-hidden">
        <GridDots />

        {/* Glow ambient background */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[500px] rounded-full pointer-events-none"
             style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, rgba(139,92,246,0.04) 60%, transparent 80%)' }} />

        {/* Minimal Pre-Beta & 100% Azerbaijan product pill */}
        <AnimateIn delay={0}>
          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium tracking-wide border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Pre-Beta Versiya
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide border border-amber-500/30 bg-amber-500/10 text-amber-300">
              🇦🇿 BahAI 100% Azərbaycan məhsuludur
            </div>
          </div>
        </AnimateIn>

        {/* Main Headline */}
        <AnimateIn delay={0.1}>
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold text-center max-w-4xl leading-[1.1] tracking-tight mb-6 text-slate-100">
            Süni İntellektdə
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-purple-400">
              Bahardan ilhamlanaraq yaratdıq 🌿
            </span>
          </h1>
        </AnimateIn>

        {/* Description */}
        <AnimateIn delay={0.2}>
          <p className="text-slate-400 text-center max-w-xl text-base sm:text-lg mb-8 leading-relaxed">
            Sual verin, canlı internet axtarışı aparın və ya mürəkkəb məntiq suallarını həll edin. BahAI — sadə, sürətli və 100% azərbaycan dilinə uyğunlaşdırılmış AI platformasıdır.
          </p>
        </AnimateIn>

        {/* Action Button */}
        <AnimateIn delay={0.25}>
          <div className="flex items-center gap-4 mb-12">
            <button
              onClick={onGetStarted}
              className="group flex items-center gap-3 px-8 py-3.5 rounded-xl text-sm font-semibold transition-all active:scale-95 shadow-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer shadow-emerald-500/25"
            >
              <Sparkles size={16} />
              İndi Sınayın
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </AnimateIn>

        {/* Clean Live Chat Interface Preview Card */}
        <AnimateIn delay={0.3}>
          <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6 shadow-2xl backdrop-blur-xl text-left font-sans space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className="text-xs text-slate-400 ml-2 font-mono">bahAI Web Session</span>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">Bahar Smart • Online</span>
            </div>

            {/* User message */}
            <div className="flex items-start gap-3 justify-end">
              <div className="bg-emerald-600/20 border border-emerald-500/30 rounded-2xl rounded-tr-sm px-4 py-2.5 text-xs sm:text-sm text-slate-200 max-w-[85%]">
                2026-cı il idman xəbərlərini və ya Bakı havanı canlı axtara bilərsən?
              </div>
            </div>

            {/* AI message */}
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/30">
                <Sparkles size={14} className="text-slate-950" />
              </div>
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl rounded-tl-sm px-4 py-3 text-xs sm:text-sm text-slate-300 space-y-2 max-w-[90%]">
                <p>Bəli! Dərhal canlı <code className="bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded font-mono text-[11px]">Tavily AI Search</code> alətini işlədib ən dəqiq faktiki nəticəni təqdim edirəm.</p>
                <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-700/40 flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-emerald-400" />
                  <span>Daxili monoloqsuz, birbaşa cavab qatı aktivdir.</span>
                </div>
              </div>
            </div>
          </div>
        </AnimateIn>

        {/* Pre-Beta Note */}
        <div className="mt-8 text-center text-xs text-slate-500 max-w-md">
          ℹ️ Pre-Beta sınaq dövründəyik. Fayl yükləmələri müvəqqəti passivdir; mətn və canlı axtarış funksionallığı 100% aktivdir.
        </div>
        {/* Scroll indicator */}
        <div className="absolute bottom-4 animate-bounce" style={{ opacity: 0.3 }}>
          <ChevronDown size={24} />
        </div>
      </section>

      {/* Stats Bar */}
      <section className="border-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="max-w-5xl mx-auto grid grid-cols-3 divide-x" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="py-8 md:py-12 text-center" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1 text-emerald-400">
              Canlı
            </div>
            <div className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-zinc-500">
              CHAT-FIRST WEB
            </div>
          </div>
          <div className="py-8 md:py-12 text-center" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1 text-amber-400">
              In Dev
            </div>
            <div className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-zinc-500">
              DESKTOP CODE AGENT
            </div>
          </div>
          <div className="py-8 md:py-12 text-center" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1 text-purple-400">
              Pre-Beta
            </div>
            <div className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-zinc-500">
              FAZA
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative px-5 md:px-10 py-20 md:py-32 scroll-mt-16">
        <GridDots />
        <div className="max-w-5xl mx-auto">
          <AnimateIn>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-accent)' }} />
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">XÜSUSİYYƏTLƏR</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-bold mb-4" style={{ color: '#f0f0f0' }}>
              İki səth, bir sistem
            </h2>
            <p className="text-zinc-400 max-w-xl mb-16 text-base md:text-lg leading-relaxed">
              BahAI Cloud gündəlik chat və düşünmə işləri üçündür. BahAI Desktop isə daha güclü icra səthi kimi qurulur.
            </p>
          </AnimateIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {features.map((f, i) => (
              <AnimateIn key={i} delay={i * 0.05}>
                <div
                  className="group p-6 rounded-xl transition-all duration-300 hover:translate-y-[-2px]"
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                    style={{ background: `${f.color}15`, color: f.color }}
                  >
                    {f.icon}
                  </div>
                  <h3 className="text-base font-bold mb-2" style={{ color: '#f0f0f0' }}>{f.title}</h3>
                  <p className="text-sm leading-relaxed text-zinc-400">{f.desc}</p>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how" className="relative px-5 md:px-10 py-20 md:py-32 scroll-mt-16" style={{ background: 'rgba(255,255,255,0.01)' }}>
        <div className="max-w-5xl mx-auto">
          <AnimateIn>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-accent)' }} />
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">NECƏ İŞLƏYİR</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-bold mb-4" style={{ color: '#f0f0f0' }}>
              3 sadə addım
            </h2>
            <p className="text-zinc-400 max-w-xl mb-16 text-base md:text-lg">
              Məhsul səthi sadə qalır, arxadakı mürəkkəbliyi isə BahAI idarə edir.
            </p>
          </AnimateIn>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {steps.map((s, i) => (
              <AnimateIn key={i} delay={i * 0.1}>
                <div
                  className="relative p-6 md:p-8 rounded-xl"
                  style={{
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <span
                    className="absolute top-5 right-6 text-4xl font-black leading-none"
                    style={{ color: 'rgba(255,255,255,0.04)' }}
                  >
                    {s.num}
                  </span>
                  <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--color-accent)' }}>{s.title}</h3>
                  <p className="text-sm leading-relaxed text-zinc-400">{s.desc}</p>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative px-5 md:px-10 py-20 md:py-32 scroll-mt-16">
        <GridDots />
        <div className="max-w-2xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-12">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-accent)' }} />
                <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">QİYMƏT</span>
              </div>
              <h2 className="text-3xl md:text-5xl font-bold mb-3" style={{ color: '#f0f0f0' }}>
                Tamamilə pulsuz
              </h2>
              <p className="text-zinc-400 text-base md:text-lg">
                PreBeta mərhələsində bütün xüsusiyyətlər açıqdır.
              </p>
            </div>
          </AnimateIn>

          <AnimateIn delay={0.1}>
            <div
              className="relative p-8 md:p-12 rounded-2xl text-center overflow-hidden"
              style={{
                background: 'linear-gradient(180deg, rgba(16,163,127,0.12) 0%, rgba(16,163,127,0.03) 100%)',
                border: '1px solid rgba(16,163,127,0.2)',
              }}
            >
              <div className="absolute top-0 right-0 opacity-5">
                <Zap size={120} />
              </div>

              <h3 className="text-xl md:text-2xl font-bold mb-2" style={{ color: '#f0f0f0' }}>PreBeta Test Rejimi</h3>
              <p className="text-zinc-400 mb-8 text-sm leading-relaxed max-w-md mx-auto">
                Məqsədimiz Azərbaycanda istifadəsi rahat, pulsuz və praktik AI iş mühiti qurmaqdır.
              </p>

              <div className="flex items-baseline justify-center gap-2 mb-8">
                <span className="text-5xl md:text-6xl font-black" style={{ color: '#f0f0f0' }}>0</span>
                <span className="text-lg font-medium text-zinc-500">AZN / həmişə</span>
              </div>

              <div className="space-y-3 mb-10 text-left max-w-sm mx-auto">
                {[
                  'BahAI Cloud chat təcrübəsi',
                  'Desktop üçün Cloud / Local keçidi',
                  'Arxa fon model routing',
                  'Orchestration və workflow bazası',
                  'Genişlənən GUI və agent imkanları',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <CheckCircle2 size={16} style={{ color: 'var(--color-accent)' }} />
                    <span className="text-sm text-zinc-300">{item}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={onGetStarted}
                className="group w-full flex items-center justify-center gap-2.5 py-4 rounded-xl text-base font-bold transition-all active:scale-[0.97] shadow-lg"
                style={{
                  background: 'var(--color-accent)',
                  color: 'white',
                  boxShadow: '0 8px 32px rgba(16,163,127,0.3)',
                }}
              >
                <Sparkles size={18} />
                Pulsuz Başla
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </AnimateIn>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-5 md:px-10 py-20 md:py-28">
        <AnimateIn>
          <div
            className="max-w-3xl mx-auto text-center p-8 md:p-14 rounded-2xl relative overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <GridDots />
            <h2 className="text-2xl md:text-4xl font-bold mb-4 relative z-10" style={{ color: '#f0f0f0' }}>
              BahAI ilə işə başla
            </h2>
            <p className="text-zinc-400 mb-8 text-sm md:text-base max-w-md mx-auto relative z-10">
              Web-də sürətli danış, desktop-da daha dərin icra et. Eyni sistem, iki fərqli ritm.
            </p>
            <button
              onClick={onGetStarted}
              className="group relative z-10 inline-flex items-center gap-2.5 px-8 py-4 rounded-xl text-base font-bold transition-all active:scale-[0.97] shadow-lg"
              style={{
                background: 'var(--color-accent)',
                color: 'white',
                boxShadow: '0 8px 32px rgba(16,163,127,0.3)',
              }}
            >
              Daxil ol
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </AnimateIn>
      </section>

      {/* Footer */}
      <footer className="border-t px-5 md:px-10 py-8 md:py-12" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center"
              style={{ background: 'var(--color-accent)' }}
            >
              <Bot size={14} className="text-white" />
            </div>
            <span className="text-sm font-bold tracking-tight uppercase">
              bah<span style={{ color: 'var(--color-accent)' }}>AI</span>
            </span>
          </div>
          <p className="text-zinc-600 text-[11px] uppercase tracking-widest">
            © 2026 bahAI Intelligence — Bütün hüquqlar qorunur
          </p>
        </div>
      </footer>

    </div>
  );
}
