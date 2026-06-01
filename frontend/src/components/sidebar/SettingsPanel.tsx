import { useMemo, useState } from 'react';
import { Code2, Zap, Search, Globe, Key, ShieldAlert } from 'lucide-react';
import { MODELS } from '../../lib/constants';
import { useSettings } from '../../hooks/useSettings';

export default function SettingsPanel() {
  const { 
    model, setModel, 
    performanceMode, setPerformanceMode,
    apiKey, setApiKey,
    baseUrl, setBaseUrl
  } = useSettings();
  
  const [query, setQuery] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(() => {
    return baseUrl && !baseUrl.includes('openrouter.ai');
  });

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

  const handlePreset = (type: 'ollama' | 'lmstudio' | 'openrouter') => {
    if (type === 'ollama') {
      setBaseUrl('http://localhost:11434/v1');
      setApiKey('ollama');
      setModel('qwen2.5-coder:latest');
      setIsCustomMode(true);
    } else if (type === 'lmstudio') {
      setBaseUrl('http://localhost:1234/v1');
      setApiKey('lm-studio');
      setModel('qwen2.5-coder-7b');
      setIsCustomMode(true);
    } else {
      setBaseUrl('https://openrouter.ai/api/v1');
      setApiKey('');
      setModel('qwen/qwen3-coder:free');
      setIsCustomMode(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-hover)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 12px',
    fontSize: '13px',
    outline: 'none',
    color: 'var(--fg-main)',
    transition: 'border-color 0.2s',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--fg-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '4px',
  };

  return (
    <div className="space-y-4">
      {/* Provider Selector Tab */}
      <div className="flex rounded-lg p-0.5 bg-[var(--bg-hover)] border border-[var(--border)]">
        <button
          onClick={() => {
            setIsCustomMode(false);
            handlePreset('openrouter');
          }}
          className="flex-1 py-1 text-[11px] font-medium rounded-md transition-all"
          style={{
            background: !isCustomMode ? 'var(--bg-main)' : 'transparent',
            color: !isCustomMode ? 'var(--fg-main)' : 'var(--fg-muted)',
            boxShadow: !isCustomMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}
        >
          Bulud (bahAI)
        </button>
        <button
          onClick={() => {
            setIsCustomMode(true);
            setBaseUrl('http://localhost:11434/v1');
          }}
          className="flex-1 py-1 text-[11px] font-medium rounded-md transition-all"
          style={{
            background: isCustomMode ? 'var(--bg-main)' : 'transparent',
            color: isCustomMode ? 'var(--fg-main)' : 'var(--fg-muted)',
            boxShadow: isCustomMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}
        >
          Lokal / Xüsusi LLM
        </button>
      </div>

      {!isCustomMode ? (
        <div className="space-y-4">
          {/* Model selection */}
          <div className="space-y-2">
            <label style={labelStyle}>
              <Code2 size={12} /> Model Seçin
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Model axtar..."
                style={{ ...inputStyle, paddingLeft: '32px' }}
              />
            </div>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {filteredModels.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
              ))}
            </select>
            <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
              Aktiv: <span style={{ color: 'var(--fg-main)' }}>{selected?.name || model}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-hover)] bg-opacity-30">
          <div className="flex items-center justify-between">
            <span style={labelStyle}>⚡ Cəld Şablonlar:</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => handlePreset('ollama')}
                className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--bg-main)] hover:bg-[var(--bg-hover)] text-[var(--fg-main)] font-semibold transition-all"
              >
                Ollama
              </button>
              <button
                onClick={() => handlePreset('lmstudio')}
                className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--bg-main)] hover:bg-[var(--bg-hover)] text-[var(--fg-main)] font-semibold transition-all"
              >
                LM Studio
              </button>
            </div>
          </div>

          {/* Base URL */}
          <div className="space-y-1">
            <label style={labelStyle}>
              <Globe size={12} /> API Endpoint (Base URL)
            </label>
            <input
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              style={inputStyle}
            />
          </div>

          {/* API Key */}
          <div className="space-y-1">
            <label style={labelStyle}>
              <Key size={12} /> API Key (Açar)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="ollama (və ya boş qoyun)"
              style={inputStyle}
            />
          </div>
          {/* Custom Model ID */}
          <div className="space-y-1">
            <label style={labelStyle}>
              <Code2 size={12} /> Model ID
            </label>
            <input
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="qwen2.5-coder:latest"
              style={inputStyle}
            />
          </div>

          <div className="flex gap-2 items-start p-2 rounded bg-[var(--bg-main)] border border-[var(--border)] text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            <ShieldAlert size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <span>
              Lokal LLM-lər tamamilə offline işləyir. Cihazınızda <strong>Ollama</strong> və ya <strong>LM Studio</strong>-nun aktiv olduğundan əmin olun.
            </span>
          </div>
        </div>
      )}

      {/* Performance mode */}
      <div className="space-y-1.5 pt-2">
        <button
          onClick={() => setPerformanceMode(!performanceMode)}
          className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
          role="switch"
          aria-checked={performanceMode}
        >
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--fg-main)' }}>
            <Zap size={14} style={{ color: performanceMode ? 'var(--color-accent)' : 'var(--fg-muted)' }} />
            Performans Rejimi
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
          Animasiyaları və arxa fon bulanıqlığını söndürərək performansı artırır.
        </p>
      </div>
    </div>
  );
}
