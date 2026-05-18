import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Save, X, FileCode, Check, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../../lib/constants';
import { useToast } from '../common/Toast';
import { Spinner } from '../common/UI';

interface Props {
  filePath: string;
  workingDirectory: string;
  onClose: () => void;
}

function getAuthHeader() {
  const token = localStorage.getItem('auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  py: 'python',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html',
  json: 'json', jsonc: 'json',
  md: 'markdown',
  yml: 'yaml', yaml: 'yaml',
  xml: 'xml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  sql: 'sql',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  vue: 'html',
  svelte: 'html',
  astro: 'html',
  dockerfile: 'dockerfile',
  toml: 'ini',
  ini: 'ini',
  env: 'ini',
};

export default function CodeEditor({ filePath, workingDirectory, onClose }: Props) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [theme, setTheme] = useState<'vs-dark' | 'light'>('vs-dark');
  const toast = useToast();

  // Sync with theme
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      setTheme(isDark ? 'vs-dark' : 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // Initial
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    setTheme(isDark ? 'vs-dark' : 'light');
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchFile = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/read-file?path=${encodeURIComponent(filePath)}&workingDirectory=${encodeURIComponent(workingDirectory)}`,
          { headers: getAuthHeader() }
        );
        if (!response.ok) throw new Error('Failed to read file');
        const data = await response.json();
        setContent(data.content || '');
        setOriginalContent(data.content || '');
      } catch {
        toast.error('Failed to load file');
        setContent('');
      } finally {
        setLoading(false);
      }
    };
    fetchFile();
  }, [filePath, workingDirectory]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/write-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ path: filePath, content, workingDirectory }),
      });
      if (!response.ok) throw new Error('Save failed');
      setOriginalContent(content);
      setSaveSuccess(true);
      toast.success('File saved');
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      toast.error('Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (content !== originalContent && !saving) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [content, originalContent, saving]);

  const isDirty = content !== originalContent;
  const fileName = filePath.split('/').pop() || 'Untitled';
  const fileExtension = filePath.split('.').pop()?.toLowerCase() || 'plaintext';
  const language = LANGUAGE_MAP[fileExtension] || 'plaintext';

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: 'var(--bg-main)' }}>
      {/* Editor body */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--bg-main)' }}>
            <Spinner size={24} />
          </div>
        ) : (
          <Editor
            height="100%"
            language={language}
            theme={theme}
            value={content}
            onChange={(value) => setContent(value || '')}
            options={{
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              padding: { top: 12, bottom: 12 },
              fontFamily: "'Fira Code', 'JetBrains Mono', 'SF Mono', monospace",
              fontLigatures: true,
              lineNumbers: 'on',
              renderLineHighlight: 'line',
              bracketPairColorization: { enabled: true },
              automaticLayout: true,
            }}
          />
        )}
      </div>

      {/* Bottom bar */}
      <div
        className="h-8 flex items-center justify-between px-3 shrink-0"
        style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>{language}</span>
          {isDirty && (
            <span className="text-[10px]" style={{ color: 'var(--color-warning)' }}>Modified</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors"
            style={{
              background: isDirty ? 'var(--color-accent)' : 'transparent',
              color: isDirty ? 'var(--fg-on-accent)' : 'var(--fg-muted)',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? <Loader2 size={10} className="animate-spin" /> : saveSuccess ? <Check size={10} /> : <Save size={10} />}
            {saveSuccess ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
