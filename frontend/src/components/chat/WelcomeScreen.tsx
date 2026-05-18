import { Bot } from 'lucide-react';

interface Props {
  onSend: (msg: string) => void;
}

export default function WelcomeScreen({ onSend }: Props) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 pb-32">
      {/* Logo */}
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
        style={{ background: 'var(--color-accent)' }}
      >
        <Bot size={32} className="text-white" />
      </div>

      {/* Heading */}
      <h2 className="text-2xl font-semibold mb-8" style={{ color: 'var(--fg-main)' }}>
        Necə kömək edə bilərəm?
      </h2>

      {/* Suggestion cards */}
      <div className="flex flex-wrap justify-center gap-3 max-w-2xl">
        {[
          { label: 'React app yarat', prompt: 'Create a new React app with TypeScript and Tailwind CSS' },
          { label: 'Səhv düzəlt', prompt: 'Help me fix a bug in my code' },
          { label: 'Kodu izah et', prompt: 'Explain what this code does' },
          { label: 'Funksiya əlavə et', prompt: 'Add a new feature to my project' },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => onSend(item.prompt)}
            className="px-4 py-2.5 rounded-xl text-sm transition-all"
            style={{
              border: '1px solid var(--border)',
              color: 'var(--fg-secondary)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
