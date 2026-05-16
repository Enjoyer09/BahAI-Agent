// ==========================================
// Terminal — High Performance Optimized Version
// ==========================================

import { useState, useEffect, useRef, memo } from 'react';
import { Terminal as TerminalIcon, Trash2, ChevronDown } from 'lucide-react';

interface LogEntry {
  id: string;
  type: 'info' | 'error' | 'success' | 'command';
  content: string;
  timestamp: string; // Already formatted
}

const LogRow = memo(({ log }: { log: LogEntry }) => (
  <div className="mb-1 flex gap-3 animate-in fade-in duration-200">
    <span className="text-gray-600 shrink-0 opacity-40 font-mono text-[10px]">
      {log.timestamp}
    </span>
    <span className={`break-words ${
      log.type === 'error' ? 'text-red-400' : 
      log.type === 'success' ? 'text-green-400' : 
      log.type === 'command' ? 'text-blue-400 font-bold' : 
      'text-gray-300'
    }`}>
      {log.type === 'command' && <span className="mr-2 text-gray-500">$</span>}
      {log.content}
    </span>
  </div>
));

const Terminal = memo(() => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleLog = (e: any) => {
      const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const newLog: LogEntry = {
        id: Math.random().toString(36).slice(2),
        ...e.detail,
        timestamp: timeStr
      };
      setLogs(prev => [...prev.slice(-100), newLog]);
    };
    window.addEventListener('terminal-log', handleLog);
    return () => window.removeEventListener('terminal-log', handleLog);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="absolute bottom-6 right-6 h-10 px-5 flex items-center gap-3 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:scale-105 transition-all shadow-2xl z-40 active:scale-95"
      >
        <TerminalIcon size={14} /> Open Terminal
      </button>
    );
  }

  return (
    <div className="h-48 flex flex-col bg-black/20 border-t border-white/10 backdrop-blur-md">
      <div className="h-10 flex items-center justify-between px-5 bg-white/[0.02] border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.2em] text-gray-400">
          <TerminalIcon size={12} className="text-blue-500" /> Terminal / Output
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setLogs([])} className="p-1 text-gray-600 hover:text-red-400 transition-colors" title="Clear">
            <Trash2 size={13} />
          </button>
          <button onClick={() => setIsOpen(false)} className="p-1 text-gray-600 hover:text-white transition-colors">
            <ChevronDown size={16} />
          </button>
        </div>
      </div>
      <div 
        ref={scrollRef} 
        className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed custom-scrollbar bg-black/10"
      >
        {logs.length === 0 ? (
          <div className="text-gray-700 italic opacity-50">Waiting for terminal output...</div>
        ) : (
          logs.map(log => <LogRow key={log.id} log={log} />)
        )}
      </div>
    </div>
  );
});

export default Terminal;
