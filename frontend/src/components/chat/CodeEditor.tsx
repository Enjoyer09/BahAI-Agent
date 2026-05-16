// ==========================================
// CodeEditor — Fully Functional Editor
// ==========================================

import { useState, useEffect } from 'react';
import { Save, FileCode, X, Loader2, Check } from 'lucide-react';
import { API_BASE_URL } from '../../lib/constants';

interface CodeEditorProps {
  filePath: string;
  projectDir: string;
  onClose: () => void;
}

export default function CodeEditor({ filePath, projectDir, onClose }: CodeEditorProps) {
  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const getFullPath = () => {
    const cleanDir = projectDir.endsWith('/') ? projectDir.slice(0, -1) : projectDir;
    const cleanFile = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    return `${cleanDir}/${cleanFile}`;
  };

  useEffect(() => {
    const fetchContent = async () => {
      if (!filePath || !projectDir) return;
      try {
        const fullPath = getFullPath();
        const res = await fetch(`${API_BASE_URL}/api/read-file?filepath=${encodeURIComponent(fullPath)}&workingDirectory=${encodeURIComponent(projectDir)}`);
        const data = await res.json();
        setContent(data.content || '');
        setIsDirty(false);
      } catch (err) {
        console.error('Failed to read file:', err);
        setContent('Xəta: Fayl oxuna bilmədi.');
      }
    };
    fetchContent();
  }, [filePath, projectDir]);

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const fullPath = getFullPath();
      const res = await fetch(`${API_BASE_URL}/api/write-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filepath: fullPath,
          content: content,
          workingDirectory: projectDir
        })
      });
      if (res.ok) {
        setIsDirty(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch (err) {
      console.error('Save failed:', err);
      alert('Faylı yadda saxlamaq mümkün olmadı.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#1e1e1e] border-l border-[var(--panel-border)] animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-black/20">
        <div className="flex items-center gap-2 text-[13px] text-gray-300">
          <FileCode size={16} className="text-blue-400" />
          <span className="truncate max-w-[300px] font-medium">{filePath}</span>
          {isDirty && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleSave}
            disabled={!isDirty || saving}
            className={`p-1.5 rounded transition-all flex items-center gap-2 text-xs font-bold ${
              isDirty 
                ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white' 
                : 'text-gray-500 cursor-not-allowed'
            }`}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : saveSuccess ? <Check size={14} className="text-green-400" /> : <Save size={14} />}
            {isDirty && !saving && !saveSuccess && <span>SAVE</span>}
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded text-gray-400 transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>
      
      <div className="flex-1 relative overflow-hidden bg-[#1e1e1e]">
        <textarea
          value={content}
          onChange={(e) => { setContent(e.target.value); setIsDirty(true); }}
          placeholder="Loading content..."
          className="absolute inset-0 w-full h-full bg-transparent text-[#d4d4d4] font-mono text-[14px] p-6 resize-none focus:outline-none leading-relaxed selection:bg-blue-500/30"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
