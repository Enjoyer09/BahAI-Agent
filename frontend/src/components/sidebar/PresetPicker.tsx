import { useMemo, useState } from 'react';
import { Blocks, Check, ChevronDown, Loader2, Search } from 'lucide-react';
import type { PresetKind, PresetSelection } from '../../lib/types';
import { fetchPresetEntry } from '../../lib/api';
import { API_BASE_URL } from '../../lib/constants';

interface PresetIndexEntry {
  id: string;
  name: string;
  description: string;
  argumentHint?: string | null;
}

const KIND_OPTIONS: Array<{ kind: PresetKind; label: string }> = [
  { kind: 'commands', label: 'Komandalar' },
  { kind: 'agents', label: 'Agentlər' },
  { kind: 'skills', label: 'Skill-lər' },
  { kind: 'rules', label: 'Qaydalar' },
];

const KIND_CACHE = new Map<PresetKind, PresetIndexEntry[]>();

async function loadKindIndex(kind: PresetKind): Promise<PresetIndexEntry[]> {
  const cached = KIND_CACHE.get(kind);
  if (cached) return cached;
  const response = await fetch(`${API_BASE_URL}/api/presets/ecc/index?kind=${kind}`);
  if (!response.ok) throw new Error('Preset indeksi alınmadı');
  const data = await response.json();
  const entries: PresetIndexEntry[] = (data.entries || []).map((e: PresetIndexEntry) => ({
    id: e.id,
    name: e.name,
    description: e.description || '',
    argumentHint: e.argumentHint ?? null,
  }));
  KIND_CACHE.set(kind, entries);
  return entries;
}

interface Props {
  active: PresetSelection | null;
  onSelect: (selection: PresetSelection | null) => void;
}

export default function PresetPicker({ active, onSelect }: Props) {
  const [kind, setKind] = useState<PresetKind>('commands');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<PresetIndexEntry[]>(() => KIND_CACHE.get('commands') ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedBody, setExpandedBody] = useState<string | null>(null);
  const [isBodyLoading, setIsBodyLoading] = useState(false);
  const [loadedKind, setLoadedKind] = useState<PresetKind>('commands');

  if (loadedKind !== kind) {
    setLoadedKind(kind);
    setEntries(KIND_CACHE.get(kind) ?? []);
    setQuery('');
    if (KIND_CACHE.has(kind)) {
      setError(null);
    } else {
      setIsLoading(true);
      setError(null);
      loadKindIndex(kind)
        .then((list) => setEntries(list))
        .catch(() => setError('Preset siyahısı yüklənə bilmədi'))
        .finally(() => setIsLoading(false));
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 100);
    return entries
      .filter(e => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))
      .slice(0, 100);
  }, [entries, query]);

  const handleToggleExpand = async (entryId: string) => {
    if (expandedId === entryId) {
      setExpandedId(null);
      setExpandedBody(null);
      return;
    }
    setExpandedId(entryId);
    setExpandedBody(null);
    setIsBodyLoading(true);
    try {
      const entry = await fetchPresetEntry(kind, entryId);
      setExpandedBody(entry.body);
    } catch {
      setExpandedBody(null);
    } finally {
      setIsBodyLoading(false);
    }
  };

  const activeMatchesKind = active?.kind === kind;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-elevated)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <Blocks size={14} className="text-indigo-400" />
        <span className="text-sm font-semibold text-[var(--fg-main)]">ECC Preset — Aktiv Giriş</span>
      </div>
      <p className="text-xs text-[var(--fg-secondary)] mb-3">
        Hər sorğuya ən çox bir ECC girişi (komanda, agent, skill və ya qayda) əlavə olunur.
      </p>

      {active && (
        <div className="flex items-center justify-between gap-2 mb-3 p-2.5 rounded-md bg-indigo-500/10 border border-indigo-500/30">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-indigo-300 truncate">
              {active.name || active.entryId}
            </div>
            <div className="text-[10px] text-[var(--fg-muted)]">
              {KIND_OPTIONS.find(k => k.kind === active.kind)?.label ?? active.kind} · {active.entryId}
            </div>
          </div>
          <button
            onClick={() => onSelect(null)}
            className="shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-md border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg-main)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Deaktiv et
          </button>
        </div>
      )}

      <div className="flex gap-1.5 mb-2 flex-wrap">
        {KIND_OPTIONS.map(opt => (
          <button
            key={opt.kind}
            onClick={() => setKind(opt.kind)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${kind === opt.kind ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' : 'bg-[var(--bg-hover)] text-[var(--fg-muted)] border border-[var(--border)] hover:text-[var(--fg-main)]'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="relative mb-2">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)]" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Axtar..."
          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--fg-main)] outline-none focus:border-indigo-500/50"
        />
      </div>

      {error && <div className="text-xs text-red-400 py-2">{error}</div>}
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-[var(--fg-muted)] py-3">
          <Loader2 size={14} className="animate-spin" /> Yüklənir...
        </div>
      )}

      {!isLoading && !error && (
        <div className="max-h-64 overflow-y-auto custom-scrollbar rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
          {filtered.length === 0 && (
            <div className="text-xs text-[var(--fg-muted)] py-3 text-center">Nəticə tapılmadı</div>
          )}
          {filtered.map(entry => {
            const isActive = activeMatchesKind && active.entryId === entry.id;
            const isExpanded = expandedId === entry.id;
            return (
              <div key={entry.id}>
                <button
                  onClick={() => handleToggleExpand(entry.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${isExpanded ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[var(--fg-main)] flex items-center gap-1.5">
                      <span className="truncate">/{entry.id}</span>
                      {isActive && <Check size={12} className="text-indigo-400 shrink-0" />}
                    </div>
                    <div className="text-[10px] text-[var(--fg-muted)] truncate">{entry.description}</div>
                  </div>
                  <ChevronDown size={13} className={`shrink-0 text-[var(--fg-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
                {isExpanded && (
                  <div className="px-3 pb-2.5 border-t border-[var(--border)] bg-[var(--bg-surface)]">
                    {isBodyLoading ? (
                      <div className="flex items-center gap-2 text-[11px] text-[var(--fg-muted)] pt-2">
                        <Loader2 size={12} className="animate-spin" /> Yüklənir...
                      </div>
                    ) : (
                      <pre className="text-[10px] leading-relaxed text-[var(--fg-secondary)] max-h-40 overflow-y-auto custom-scrollbar pt-2 whitespace-pre-wrap break-words">
                        {expandedBody || 'Məzmun yüklənə bilmədi'}
                      </pre>
                    )}
                    <button
                      onClick={() => onSelect({ presetId: 'ecc', kind, entryId: entry.id, name: entry.name })}
                      disabled={isActive}
                      className={`mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${isActive ? 'bg-indigo-500/15 text-indigo-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                    >
                      {isActive ? (<><Check size={12} /> Aktivdir</>) : 'Seç və aktivləşdir'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
