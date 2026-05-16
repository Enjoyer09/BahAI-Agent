import { Sun, Moon, Monitor } from 'lucide-react';
import type { ThemeMode } from '../../hooks/useTheme';

interface ThemeToggleProps {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
}

const options: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'İşıqlı' },
  { value: 'system', icon: Monitor, label: 'Sistem' },
  { value: 'dark', icon: Moon, label: 'Qaranlıq' },
];

export default function ThemeToggle({ theme, setTheme }: ThemeToggleProps) {
  return (
    <div className="flex items-center rounded-lg bg-[var(--surface)] border border-[var(--border)] p-0.5">
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          title={label}
          className={`
            flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all
            ${theme === value
              ? 'bg-blue-500/15 text-blue-500 shadow-sm'
              : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-raised)]'
            }
          `}
        >
          <Icon size={13} />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
