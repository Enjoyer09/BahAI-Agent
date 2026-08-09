// ==========================================
// NewProjectDialog — Template selection for new projects
// ==========================================

import { useState } from 'react';
import { X, FolderPlus, Code2, Globe, Server, Palette, FileCode, Sparkles } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  description: string;
  icon: typeof Code2;
  color: string;
  stack: string;
}

interface NewProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (name: string, templateId: string | null) => void;
}

const TEMPLATES: Template[] = [
  {
    id: 'react-vite',
    name: 'React + Vite',
    description: 'Modern React SPA Vite ilə',
    icon: Code2,
    color: '#61dafb',
    stack: 'React, Vite, Tailwind CSS',
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    description: 'Full-stack React framework',
    icon: Globe,
    color: '#000000',
    stack: 'Next.js, React, TypeScript',
  },
  {
    id: 'express-api',
    name: 'Express API',
    description: 'REST API backend Node.js ilə',
    icon: Server,
    color: '#68a063',
    stack: 'Express, Node.js, REST',
  },
  {
    id: 'static-html',
    name: 'Static HTML',
    description: 'Sadə HTML/CSS/JS sayt',
    icon: FileCode,
    color: '#e34f26',
    stack: 'HTML, CSS, JavaScript',
  },
  {
    id: 'flask-api',
    name: 'Flask API',
    description: 'Python REST API',
    icon: Server,
    color: '#306998',
    stack: 'Flask, Python, REST',
  },
  {
    id: 'tailwind-landing',
    name: 'Landing Page',
    description: 'Gözəl landing page Tailwind ilə',
    icon: Palette,
    color: '#06b6d4',
    stack: 'HTML, Tailwind CSS, Alpine.js',
  },
];

export default function NewProjectDialog({ isOpen, onClose, onCreateProject }: NewProjectDialogProps) {
  const [projectName, setProjectName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [useAI, setUseAI] = useState(false);

  if (!isOpen) return null;

  const handleCreate = () => {
    const name = projectName.trim() || `project-${Date.now()}`;
    onCreateProject(name, useAI ? null : selectedTemplate);
    setProjectName('');
    setSelectedTemplate(null);
    setUseAI(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm bg-black/50 animate-in">
      <div
        className="w-full max-w-lg rounded-2xl p-6 shadow-2xl flex flex-col max-h-[80vh]"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <FolderPlus size={18} className="text-[var(--color-accent)]" />
            <h2 className="text-base font-bold text-[var(--fg-main)]">Yeni Layihə</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--fg-muted)]">
            <X size={16} />
          </button>
        </div>

        {/* Project name */}
        <div className="mb-4">
          <label className="text-[11px] font-medium text-[var(--fg-muted)] block mb-1.5">Layihə adı</label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="my-awesome-app"
            className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-hover)] border border-[var(--border)] outline-none focus:border-[var(--color-accent)] text-[var(--fg-main)]"
            autoFocus
          />
        </div>

        {/* AI mode toggle */}
        <div className="mb-4">
          <button
            onClick={() => setUseAI(!useAI)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
              useAI ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5' : 'border-[var(--border)] hover:border-[var(--color-accent)]/20'
            }`}
          >
            <Sparkles size={16} className={useAI ? 'text-[var(--color-accent)]' : 'text-[var(--fg-muted)]'} />
            <div className="text-left flex-1">
              <span className="text-[12px] font-semibold text-[var(--fg-main)] block">AI seçsin</span>
              <span className="text-[10px] text-[var(--fg-muted)]">Agent layihə təsvirinə görə texnologiyanı özü seçəcək</span>
            </div>
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
              useAI ? 'border-[var(--color-accent)] bg-[var(--color-accent)]' : 'border-[var(--fg-muted)]'
            }`}>
              {useAI && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
            </div>
          </button>
        </div>

        {/* Template grid */}
        {!useAI && (
          <div className="flex-1 overflow-y-auto mb-4 premium-scroll">
            <label className="text-[11px] font-medium text-[var(--fg-muted)] block mb-2">Şablon seçin</label>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTemplate(t.id)}
                  className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                    selectedTemplate === t.id
                      ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5'
                      : 'border-[var(--border)] hover:border-[var(--color-accent)]/20'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <t.icon size={14} style={{ color: t.color }} />
                    <span className="text-[11px] font-semibold text-[var(--fg-main)]">{t.name}</span>
                  </div>
                  <span className="text-[9px] text-[var(--fg-muted)] leading-tight">{t.description}</span>
                  <span className="text-[8px] text-[var(--fg-muted)] mt-1 opacity-60">{t.stack}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[12px] font-medium border border-[var(--border)] text-[var(--fg-muted)] hover:bg-[var(--bg-hover)]">
            Ləğv
          </button>
          <button
            onClick={handleCreate}
            disabled={!useAI && !selectedTemplate}
            className="flex-1 py-2.5 rounded-xl text-[12px] font-bold bg-[var(--color-accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            Yarat
          </button>
        </div>
      </div>
    </div>
  );
}
