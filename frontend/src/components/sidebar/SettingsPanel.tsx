import { useMemo, useState } from 'react';
import { Code2, Zap, Search } from 'lucide-react';
import { MODELS } from '../../lib/constants';
import { useSettings } from '../../hooks/useSettings';

export default function SettingsPanel() {
  const { model, setModel, performanceMode, setPerformanceMode } = useSettings();
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

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-hover)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 12px',
    fontSize: '13px',
    outline: 'none',
    color: 'var(--fg-main)',
  };

  return (
    <div className="space-y-4">
      {/* Model selection */}
      <div className="space-y-2">
        <label className="text-xs font-medium flex items-center gap-1.5" style={{ color: 'var(--fg-muted)' }}>
          <Code2 size={12} /> Model
        </label>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search models..."
            style={{ ...inputStyle, paddingLeft: '32px' }}
          />
        </div>
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer', appearance: 'none' as any }}
        >
          {filteredModels.map(m => (
            <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
          ))}
        </select>
        <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          Active: <span style={{ color: 'var(--fg-main)' }}>{selected?.name || model}</span>
        </div>
      </div>

      {/* Performance mode */}
      <div className="space-y-1.5">
        <button
          onClick={() => setPerformanceMode(!performanceMode)}
          className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
          role="switch"
          aria-checked={performanceMode}
        >
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--fg-main)' }}>
            <Zap size={14} style={{ color: performanceMode ? 'var(--color-accent)' : 'var(--fg-muted)' }} />
            Performance Mode
          </div>
          <div
            className="w-9 h-5 rounded-full relative transition-colors"
            style={{ background: performanceMode ? 'var(--color-accent)' : 'var(--fg-faint)' }}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
              style={{
                background: 'white',
                left: performanceMode ? '18px' : '2px',
              }}
            />
          </div>
        </button>
        <p className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          Disables animations and backdrop blur for better performance.
        </p>
      </div>
    </div>
  );
}
