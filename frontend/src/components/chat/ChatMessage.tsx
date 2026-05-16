// ==========================================
// ChatMessage — Smart Hidden Thoughts Edition
// ==========================================

import { User, Copy, Check, FileText, Sparkles, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useState, useCallback } from 'react';
import MarkdownRenderer from '../common/MarkdownRenderer';
import ToolCallCard from './ToolCallCard';
import type { Message } from '../../lib/types';

interface ChatMessageProps {
  message: Message;
  isLast?: boolean;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [showThoughts, setShowThoughts] = useState(false);
  const isBot = message.role === 'assistant';

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  if (message.role === 'tool') return null;

  // Determine if any tool calls are currently running
  const hasRunningTools = message.tool_calls?.some(tc => tc.status === 'running');
  const hasTools = message.tool_calls && message.tool_calls.length > 0;

  return (
    <div className={`group flex gap-4 mb-6 ${isBot ? '' : 'flex-row-reverse'}`}>
      {/* AVATAR */}
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 shadow-xl transition-transform group-hover:scale-105 overflow-hidden ${
        isBot 
          ? 'bg-white/5 border border-white/10 shadow-blue-600/10' 
          : 'bg-white/10 text-gray-400 border border-white/10'
      }`}>
        {isBot ? <img src="/agent_icon.png" alt="bahAI" className="w-full h-full object-cover" /> : <User size={18} />}
      </div>

      {/* CONTENT */}
      <div className={`flex-1 min-w-0 flex flex-col ${isBot ? '' : 'items-end'}`}>
        
        {/* AGENT STATUS (When thinking/executing) */}
        {isBot && hasRunningTools && !showThoughts && (
          <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 w-fit">
            <Loader2 size={12} className="text-blue-400 animate-spin" />
            <span className="text-[11px] font-bold text-blue-400 uppercase tracking-widest">Düşünür / İcra edir...</span>
          </div>
        )}

        <div className={`relative max-w-[92%] rounded-2xl px-5 py-3.5 leading-relaxed shadow-2xl transition-all border break-words ${
          isBot 
            ? 'bg-[var(--bubble-bot)] border-[var(--panel-border)] text-[var(--fg-main)]' 
            : 'bg-blue-600 border-blue-500/50 text-white shadow-blue-600/20'
        }`}>
          {/* Attachments Area */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {message.attachments.map((at, i) => (
                <div key={i} className="max-w-[160px] rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-black/40">
                  {at.type === 'image' ? (
                    <img src={at.url} alt="attachment" className="w-full h-auto object-cover opacity-90" />
                  ) : (
                    <div className="p-3 flex items-center gap-3">
                      <FileText size={18} className="text-blue-400" />
                      <span className="text-[11px] truncate font-bold text-gray-300">{at.name}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="prose prose-invert prose-sm max-w-none">
            <MarkdownRenderer content={message.content || ''} />
          </div>

          {/* COPY ACTION */}
          <button onClick={copyToClipboard} className="absolute top-3 right-3 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-white/10 active:scale-90 text-gray-500">
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
        </div>

        {/* HIDDEN THOUGHTS / TOOL CALLS */}
        {isBot && hasTools && (
          <div className="mt-3 w-full max-w-[92%]">
            <button 
              onClick={() => setShowThoughts(!showThoughts)}
              className="flex items-center gap-2 text-[10px] font-bold text-gray-500 hover:text-blue-400 transition-colors uppercase tracking-widest bg-white/5 px-3 py-1.5 rounded-lg border border-white/5"
            >
              {showThoughts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showThoughts ? 'Detalları Gizlə' : 'Agentin İşinə Bax (Expand)'}
            </button>

            {showThoughts && (
              <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                {message.tool_calls?.map((tc, j) => (
                  <ToolCallCard 
                    key={j} 
                    toolName={tc.function?.name || tc.name} 
                    args={tc.function?.arguments || tc.args} 
                    result={tc.result}
                    status={tc.status}
                    duration={tc.duration}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        
        <div className="mt-2 text-[10px] font-bold tracking-widest uppercase text-gray-600 px-1">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
