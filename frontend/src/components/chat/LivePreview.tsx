// ==========================================
// LivePreview — The "WOW" factor for iBahora
// ==========================================

import { useState, useEffect, useRef } from 'react';
import { Globe, RefreshCw, Maximize2, ExternalLink, Zap } from 'lucide-react';

interface LivePreviewProps {
  url?: string;
  isVisible: boolean;
  refreshKey?: number;
}

export default function LivePreview({ url = 'http://localhost:5173', isVisible, refreshKey }: LivePreviewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const reload = () => {
    setLoading(true);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  useEffect(() => {
    if (isVisible) reload();
  }, [isVisible, refreshKey]); // Refresh on key change

  // Auto-reload on workspace updates would be triggered from parent
  
  return (
    <div className={`flex flex-col h-full bg-white transition-all duration-500 overflow-hidden ${isVisible ? 'w-full' : 'w-0'}`}>
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 bg-[#f1f5f9] border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3 flex-1">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 rounded-lg shadow-sm max-w-md flex-1">
            <Globe size={14} className="text-gray-400" />
            <span className="text-[11px] font-medium text-gray-600 truncate">{url}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1 ml-4">
          <button 
            onClick={reload}
            className={`p-2 hover:bg-white rounded-lg transition-all text-gray-500 ${loading ? 'animate-spin text-blue-500' : ''}`}
          >
            <RefreshCw size={16} />
          </button>
          <button className="p-2 hover:bg-white rounded-lg transition-all text-gray-500">
            <ExternalLink size={16} />
          </button>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 relative bg-[#f8fafc] group">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="flex flex-col items-center gap-3">
              <Zap size={32} className="text-blue-500 fill-blue-500 animate-pulse" />
              <span className="text-xs font-black uppercase tracking-widest text-blue-600">Sinxronlaşdırılır...</span>
            </div>
          </div>
        )}
        
        <iframe 
          ref={iframeRef}
          src={url}
          className="w-full h-full border-none"
          onLoad={() => setLoading(false)}
          onError={() => { setError(true); setLoading(false); }}
        />

        {!loading && (
          <div className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
             <div className="px-4 py-2 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-2xl flex items-center gap-2">
                <Zap size={12} className="fill-white" /> Live Mode
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
