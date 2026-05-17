// ==========================================
// ChatInput — Modern Tailwind v4 Version
// ==========================================

import { useState, useRef, useEffect } from 'react';
import { Send, Square, Paperclip, X } from 'lucide-react';
import type { Attachment } from '../../lib/types';

interface ChatInputProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  loading: boolean;
  disabled?: boolean;
}

export default function ChatInput({ onSend, onStop, loading, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [text]);

  const handleSend = () => {
    if ((text.trim() || attachments.length > 0) && !loading) {
      onSend(text, attachments);
      setText('');
      setAttachments([]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachments(prev => [...prev, {
          id: Math.random().toString(36).substring(7),
          name: file.name,
          type: file.type.startsWith('image/') ? 'image' : 'file',
          mimeType: file.type || 'application/octet-stream',
          url: ev.target?.result as string
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <div className="bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-2xl p-3 flex flex-col gap-3 shadow-2xl transition-all focus-within:border-white/20">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {attachments.map((at, i) => (
            <div key={i} className="group relative w-12 h-12 rounded-xl overflow-hidden border border-white/10 bg-black shadow-lg">
              {at.type === 'image' ? (
                <img src={at.url} className="w-full h-full object-cover opacity-80" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[8px] font-bold text-gray-500">FILE</div>
              )}
              <button 
                onClick={() => setAttachments(p => p.filter((_, idx) => idx !== i))}
                className="absolute inset-0 bg-red-500/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={14} className="text-white" />
              </button>
            </div>
          ))}
        </div>
      )}
      
      <div className="flex items-end gap-3">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Ask anything or type / to use a tool..."
          disabled={disabled}
          className="flex-1 bg-transparent border-none text-[var(--fg-main)] placeholder-gray-500 outline-none text-sm resize-none py-1 min-h-[28px] max-h-[150px] leading-relaxed"
        />
        
        <div className="flex items-center gap-2 pb-0.5">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-500 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-white/5"
          >
            <Paperclip size={18} />
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple className="hidden" />

          {loading ? (
            <button 
              onClick={onStop}
              className="h-8 w-8 flex items-center justify-center bg-red-500/10 text-red-500 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-all"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button 
              onClick={handleSend}
              disabled={!text.trim() && attachments.length === 0}
              className={`h-8 w-8 flex items-center justify-center rounded-lg transition-all ${
                (!text.trim() && attachments.length === 0) 
                  ? 'bg-white/5 text-gray-600 cursor-not-allowed' 
                  : 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 hover:scale-105 active:scale-95'
              }`}
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
