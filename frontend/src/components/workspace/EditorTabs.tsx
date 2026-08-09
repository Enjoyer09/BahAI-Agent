// ==========================================
// EditorTabs — Tab bar for multi-file editing
// ==========================================

import { X, Circle } from 'lucide-react';

export interface EditorTab {
  id: string;
  filePath: string;
  label: string;
  isDirty: boolean;
  language: string;
}

interface EditorTabsProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact',
    js: 'javascript', jsx: 'javascriptreact',
    json: 'json', md: 'markdown', css: 'css', scss: 'scss',
    html: 'html', py: 'python', rs: 'rust', go: 'go',
    yml: 'yaml', yaml: 'yaml', toml: 'toml',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    sql: 'sql', xml: 'xml', svg: 'xml',
  };
  return map[ext] || 'plaintext';
}

export function createTab(filePath: string): EditorTab {
  const label = filePath.split('/').pop() || filePath;
  return {
    id: filePath,
    filePath,
    label,
    isDirty: false,
    language: getLanguageFromPath(filePath),
  };
}

export default function EditorTabs({ tabs, activeTabId, onSelectTab, onCloseTab }: EditorTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <div
      className="flex items-center shrink-0 overflow-x-auto no-scrollbar"
      style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        minHeight: '35px',
      }}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer text-[12px] border-r shrink-0 select-none transition-colors ${
              isActive
                ? 'bg-[var(--bg-main)] text-[var(--fg-main)]'
                : 'text-[var(--fg-muted)] hover:text-[var(--fg-main)] hover:bg-[var(--bg-hover)]'
            }`}
            style={{
              borderColor: 'var(--border-subtle)',
              borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
              maxWidth: '160px',
            }}
          >
            {/* Dirty indicator */}
            {tab.isDirty && (
              <Circle size={6} fill="var(--color-accent)" className="shrink-0 text-[var(--color-accent)]" />
            )}

            {/* Tab label */}
            <span className="truncate flex-1">{tab.label}</span>

            {/* Close button */}
            <button
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-active)] transition-opacity"
              aria-label={`Close ${tab.label}`}
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
