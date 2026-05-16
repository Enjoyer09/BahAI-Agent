// ==========================================
// WelcomeScreen — Empty state hero
// ==========================================

import { Bot, Terminal, Search, FileCode2, SquareTerminal } from 'lucide-react';

export default function WelcomeScreen() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 pb-20">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-2xl scale-150 animate-pulse" />
        <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/20 flex items-center justify-center shadow-[0_0_40px_rgba(59,130,246,0.15)]">
          <Bot size={40} className="text-blue-400" />
        </div>
      </div>

      <h2 className="text-2xl font-semibold mb-2 tracking-tight" style={{ color: 'var(--fg)' }}>
        Necə kömək edə bilərəm?
      </h2>
      <p className="text-sm max-w-md mb-10 leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        Mən lokal fayllarınızı oxuyub, kod yazıb, axtarış aparıb bash əmrləri icra edə bilən avtonom kodlaşdırma agentiyəm.
      </p>

      <div className="grid grid-cols-2 gap-3 max-w-md w-full">
        {[
          { icon: Search, label: 'Kod axtar', desc: 'grep & glob ilə', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
          { icon: FileCode2, label: 'Faylları redaktə et', desc: 'Sətir-sətir dəyişiklik', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
          { icon: Terminal, label: 'Layihəni analiz et', desc: 'Fayl ağacı & oxuma', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
          { icon: SquareTerminal, label: 'Bash əmrləri', desc: 'Shell əmrləri icra et', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
        ].map(({ icon: Icon, label, desc, color, bg, border }) => (
          <div key={label} className={`${bg} ${border} border rounded-xl p-4 text-left hover:scale-[1.02] transition-transform cursor-default`}>
            <Icon size={18} className={`${color} mb-2`} />
            <div className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{label}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
