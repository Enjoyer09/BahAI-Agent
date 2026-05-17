import { useMemo, useState } from 'react';
import { Code2, Zap, Search } from 'lucide-react';
import { MODELS } from '../../lib/constants';

interface SettingsPanelProps {
  model: string; setModel: (v: string) => void;
  performanceMode: boolean; setPerformanceMode: (v: boolean) => void;
}

function SettingField({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-[11px] font-semibold flex items-center gap-2 text-[var(--fg-muted)]">
        <Icon size={12} /> {label}
      </label>
      {children}
    </div>
  );
}

export default function SettingsPanel({ 
  model, setModel, performanceMode, setPerformanceMode 
}: SettingsPanelProps) {
  const [query, setQuery] = useState('');
  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MODELS;
    return MODELS.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  }, [query]);

  const selected = MODELS.find(m => m.id === model);
  const inputCls = 'w-full bg-[var(--bg-surface-alt)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500/40 transition-colors text-[var(--fg-main)]';

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 space-y-3">
        <SettingField icon={Code2} label="Model seçimi">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)]" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Model axtar..."
              className={`${inputCls} pl-9`}
            />
          </div>

          <select value={model} onChange={e => setModel(e.target.value)} className={`${inputCls} appearance-none cursor-pointer`}>
            {filteredModels.map(m => (
              <option key={m.id} value={m.id} className="bg-[var(--bg-surface)] text-[var(--fg-main)]">
                {m.name} ({m.provider})
              </option>
            ))}
          </select>

          <div className="text-xs text-[var(--fg-muted)]">
            Aktiv model: <span className="font-medium text-[var(--fg-main)]">{selected?.name || model}</span>
          </div>
        </SettingField>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <button 
          onClick={() => setPerformanceMode(!performanceMode)}
          className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 bg-[var(--bg-surface-alt)] border border-[var(--border)] hover:border-blue-500/30 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--fg-main)]">
            <Zap size={15} className={performanceMode ? 'text-blue-500' : 'text-[var(--fg-muted)]'} />
            Performance mode
          </div>
          <div className={`w-9 h-5 rounded-full relative transition-colors ${performanceMode ? 'bg-blue-500' : 'bg-gray-500/40'}`}>
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${performanceMode ? 'right-0.5' : 'left-0.5'}`} />
          </div>
        </button>
        <p className="mt-2 text-xs text-[var(--fg-muted)]">Açıq olduqda agent daha aqressiv plan/execution edə bilər.</p>
      </div>
    </div>
  );
}
