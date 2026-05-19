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
  Terminal,
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
      icon: <Code2 size={22} />,
      title: 'Avtonom Kodlaşdırma',
      desc: 'Faylları yaradır, redaktə edir və layihəni sıfırdan qurur. Siz sadəcə təsvir edin.',
      color: '#10a37f',
    },
    {
      icon: <Terminal size={22} />,
      title: 'Terminal və Git',
      desc: 'Əmrləri icra edir, repoları klonlayır və layihəni avtomatik qurur.',
      color: '#3b82f6',
    },
    {
      icon: <Globe size={22} />,
      title: 'Canlı Önizləmə',
      desc: 'Yazılan kodu anında brauzerdə görün. Real vaxtda dəyişikliklər.',
      color: '#8b5cf6',
    },
    {
      icon: <Shield size={22} />,
      title: 'Təhlükəsiz Rejim',
      desc: 'Həssas əməliyyatlar üçün təsdiq sistemi. Nəzarət sizdə qalır.',
      color: '#f59e0b',
    },
    {
      icon: <Cpu size={22} />,
      title: 'Çoxsaylı AI Modelləri',
      desc: 'DeepSeek, MiniMax, Nemotron və digər modellər — bir yerdə.',
      color: '#ec4899',
    },
    {
      icon: <Rocket size={22} />,
      title: 'Bir Kliklə Deploy',
      desc: 'Layihənizi GitHub və Railway-ə göndərin. Dünyada yayımlayın.',
      color: '#06b6d4',
    },
  ];

  const steps = [
    {
      num: '01',
      title: 'İdeyanı Yaz',
      desc: 'Nə yaratmaq istədiyinizi sadə dildə agentə bildirin. Məsələn: "Bir POS sistemi qur"',
    },
    {
      num: '02',
      title: 'Agent İşləyir',
      desc: 'bahAI faylları yaradır, kitabxanaları quraşdırır, kodu yazır və test edir.',
    },
    {
      num: '03',
      title: 'Canlıya Çıx',
      desc: 'Nəticəni dərhal yoxlayın və tək düymə ilə dünyada yayımlayın.',
    },
  ];

  const stats = [
    { value: '9', label: 'AI ALƏTİ' },
    { value: '15', label: 'ADDIMLI AGENT' },
    { value: '0 AZN', label: 'PULSUZ' },
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
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--color-accent)' }}
          >
            <Bot size={18} className="text-white" />
          </div>
          <span className="text-base font-bold tracking-tight uppercase">
            bah<span style={{ color: 'var(--color-accent)' }}>AI</span>
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

        {/* Ambient glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
             style={{ background: 'radial-gradient(circle, rgba(16,163,127,0.08) 0%, transparent 70%)' }} />

        <AnimateIn delay={0}>
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-8"
            style={{
              background: 'rgba(16,163,127,0.1)',
              border: '1px solid rgba(16,163,127,0.2)',
              color: '#10a37f',
            }}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#10a37f' }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#10a37f' }} />
            </span>
            PRE-BETA AKTİVDİR
          </div>
        </AnimateIn>

        <AnimateIn delay={0.1}>
          <h1
            className="text-4xl sm:text-5xl md:text-7xl font-bold text-center max-w-4xl leading-[1.08] tracking-tight mb-6"
            style={{ color: '#f0f0f0' }}
          >
            Azərbaycanın ilk və tək
            <br />
            <span
              className="font-black"
              style={{
                background: 'linear-gradient(135deg, #10a37f 0%, #06b6d4 50%, #8b5cf6 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              AI kod agenti
            </span>
          </h1>
        </AnimateIn>

        <AnimateIn delay={0.2}>
          <p className="text-zinc-400 text-center max-w-xl text-base md:text-lg mb-10 leading-relaxed">
            Proqram təminatını sıfırdan qurun. Sadəcə ideyanızı deyin,
            bahAI qalanını həll etsin — pulsuz.
          </p>
        </AnimateIn>

        <AnimateIn delay={0.3}>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={onGetStarted}
              className="group flex items-center gap-2.5 px-7 py-3.5 rounded-lg text-sm font-bold transition-all active:scale-[0.97] shadow-lg"
              style={{
                background: 'var(--color-accent)',
                color: 'white',
                boxShadow: '0 8px 32px rgba(16,163,127,0.3)',
              }}
            >
              <Sparkles size={16} />
              Pulsuz Proqramını Qur
              <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <button
              onClick={onGetStarted}
              className="flex items-center gap-2 px-6 py-3.5 rounded-lg text-sm font-semibold transition-all active:scale-[0.97]"
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#b4b4b4',
              }}
            >
              <Play size={14} />
              Canlı Bax
            </button>
          </div>
        </AnimateIn>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 animate-bounce" style={{ opacity: 0.3 }}>
          <ChevronDown size={24} />
        </div>
      </section>

      {/* Stats Bar */}
      <section className="border-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="max-w-5xl mx-auto grid grid-cols-3 divide-x" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          {stats.map((s, i) => (
            <div key={i} className="py-8 md:py-12 text-center" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1" style={{ color: '#f0f0f0' }}>
                {s.value}
              </div>
              <div className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-zinc-500">
                {s.label}
              </div>
            </div>
          ))}
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
              Hər şey bir yerdə
            </h2>
            <p className="text-zinc-400 max-w-xl mb-16 text-base md:text-lg leading-relaxed">
              bahAI sadəcə kod yazmır — o, bütün inkişaf prosesini idarə edir.
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
              Kod yazmağı bilmirsiniz? Problem deyil. bahAI hər şeyi edir.
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
                Missiyamız hər kəsə kod yazmaq imkanı verməkdir. Bu səbəbdən platforma tamamilə pulsuzdur.
              </p>

              <div className="flex items-baseline justify-center gap-2 mb-8">
                <span className="text-5xl md:text-6xl font-black" style={{ color: '#f0f0f0' }}>0</span>
                <span className="text-lg font-medium text-zinc-500">AZN / həmişə</span>
              </div>

              <div className="space-y-3 mb-10 text-left max-w-sm mx-auto">
                {[
                  'Limitsiz layihə yaratmaq',
                  'Bütün AI modellərinə giriş',
                  'Terminal və Git inteqrasiyası',
                  'Canlı önizləmə və deploy',
                  'GitHub repo klonlama',
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
                Pulsuz Proqramını Qur
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
              İdeyanızı kod çevirin
            </h2>
            <p className="text-zinc-400 mb-8 text-sm md:text-base max-w-md mx-auto relative z-10">
              bahAI ilə proqram qurmaq heç vaxt bu qədər asan olmayıb. Pulsuz başlayın.
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
