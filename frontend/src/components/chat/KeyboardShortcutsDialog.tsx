import { useEffect, useMemo } from 'react';
import { X, Keyboard as KeyboardIcon } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  label: string;
  isDesktop?: boolean;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'B'], label: 'Yan paneli aç/bağla' },
  { keys: ['Ctrl', '`'], label: 'Terminalı aç/bağla', isDesktop: true },
  { keys: ['Ctrl', 'J'], label: 'Editoru aç/bağla', isDesktop: true },
  { keys: ['Ctrl', 'Shift', 'P'], label: 'Yeni chat' },
  { keys: ['Ctrl', 'K'], label: 'Mesaj sahəsinə fokuslan' },
  { keys: ['Ctrl', '/'], label: 'Bu pəncərəni göstər' },
  { keys: ['Esc'], label: 'Dialoqları bağla' },
];

function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="px-1.5 py-0.5 rounded text-[10px] font-mono border"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--fg-secondary)' }}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

export default function KeyboardShortcutsDialog({ isOpen, onClose }: Props) {
  const isElectron = typeof window !== 'undefined'
    && (Boolean((window as any).electron?.isDesktop) || window.navigator.userAgent.includes('Electron'));

  const visibleShortcuts = useMemo(
    () => SHORTCUTS.filter((shortcut) => !shortcut.isDesktop || isElectron),
    [isElectron]
  );

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--bg-overlay, rgba(0,0,0,0.5))' }} />
      <div
        className="relative w-full max-w-md rounded-2xl overflow-hidden animate-scale-in"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-accent-muted)' }}>
              <KeyboardIcon size={18} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--fg-main)' }}>Klaviatura qısayolları</h2>
              <p className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>Ctrl (macOS-də ⌘) istifadə edin</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--fg-muted)', minHeight: '36px', minWidth: '36px' }} aria-label="Close shortcuts">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4" style={{ background: 'var(--bg-surface)' }}>
          <div className="space-y-2">
            {visibleShortcuts.map((shortcut) => (
              <div key={shortcut.keys.join('+')} className="flex items-center justify-between gap-4 py-1.5">
                <span className="text-[13px]" style={{ color: 'var(--fg-secondary)' }}>{shortcut.label}</span>
                <Kbd keys={shortcut.keys} />
              </div>
            ))}
          </div>
          {!isElectron && (
            <p className="text-[11px] mt-4" style={{ color: 'var(--fg-faint)' }}>
              Terminal və editor qısayolları yalnız desktop tətbiqində aktivdir.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
