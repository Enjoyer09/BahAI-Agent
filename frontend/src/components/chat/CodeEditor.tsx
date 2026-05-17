// ==========================================
// CodeEditor — Monaco Powered Professional Editor
// ==========================================

import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Save, X, FileCode, Check, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../../lib/constants';

interface CodeEditorProps {
  filePath: string;
  projectDir: string;
  onClose: () => void;
}

function getAuthHeader() {
  const token = localStorage.getItem('auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export default function CodeEditor({ filePath, projectDir, onClose }: CodeEditorProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [theme, setTheme] = useState<'vs-dark' | 'light'>('vs-dark');

  // Sync with system/app theme
  useEffect(() => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(isDark ? 'vs-dark' : 'light');
  }, []);

  useEffect(() => {
    const fetchFile = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/read-file?path=${encodeURIComponent(filePath)}&workingDirectory=${encodeURIComponent(projectDir)}`, {
          headers: getAuthHeader()
        });
        if (!response.ok) throw new Error('Fayl oxuna bilmədi');
        const data = await response.json();
        setContent(data.content || '');
        setOriginalContent(data.content || '');
      } catch (err) {
        console.error(err);
        setContent('Xəta: Fayl yüklənərkən problem yarandı.');
      } finally {
        setLoading(false);
      }
    };
    fetchFile();
  }, [filePath, projectDir]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/write-file`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({
          path: filePath,
          content,
          workingDirectory: projectDir
        }),
      });
      
      if (!response.ok) throw new Error('Yadda saxlamaq mümkün olmadı');
      
      setOriginalContent(content);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      alert('Xəta: Fayl yadda saxlanılmadı');
    } finally {
      setSaving(false);
    }
  };

  const isDirty = content !== originalContent;
  const fileName = filePath.split('/').pop() || 'Adsız';
  const fileExtension = filePath.split('.').pop() || 'plaintext';

  // Map common extensions to monaco languages
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'css': 'css',
    'html': 'html',
    'json': 'json',
    'md': 'markdown'
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#1e1e1e] animate-in fade-in duration-500">
      {/* Editor Header */}
      <div className="h-12 flex items-center justify-between px-6 bg-[var(--bg-surface)]/20 border-b border-white/5 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-3">
          <FileCode size={16} className="text-blue-400" />
          <div className="flex flex-col">
            <span className="text-xs font-bold text-gray-200">{fileName}</span>
            <span className="text-[9px] text-gray-500 uppercase tracking-tighter opacity-50">{filePath}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            disabled={!isDirty || saving}
            onClick={handleSave}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              isDirty 
                ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/20 active:scale-95' 
                : 'bg-white/5 text-gray-500 cursor-not-allowed'
            }`}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : (saveSuccess ? <Check size={12} /> : <Save size={12} />)}
            {saveSuccess ? 'Yadda Saxlanıldı' : 'Yadda Saxla'}
          </button>
          <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-lg transition-colors text-gray-400">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Editor Container */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1e1e1e]">
            <Loader2 size={32} className="animate-spin text-blue-500" />
          </div>
        )}
        <Editor
          height="100%"
          language={languageMap[fileExtension] || 'plaintext'}
          theme={theme}
          value={content}
          onChange={(value) => setContent(value || '')}
          options={{
            fontSize: 13,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            padding: { top: 20 },
            fontFamily: "'Fira Code', 'JetBrains Mono', monospace",
            fontLigatures: true
          }}
        />
      </div>
    </div>
  );
}
