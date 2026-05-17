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
    <div className="relative flex p-1.5 bg-black/20 border border-white/5 rounded-2xl w-full select-none backdrop-blur-md shadow-inner">
      {options.map(({ value, icon: Icon, label }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={`
              relative flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 z-10 active:scale-95
              ${isActive 
                ? 'text-white bg-blue-600 shadow-xl shadow-blue-600/30' 
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }
            `}
          >
            <Icon size={14} className={isActive ? 'animate-pulse text-white' : ''} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
