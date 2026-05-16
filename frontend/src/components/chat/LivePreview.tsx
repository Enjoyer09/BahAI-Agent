// ==========================================
// LivePreview — The "WOW" factor with Editable URL
// ==========================================

import { useState, useEffect, useRef } from 'react';
import { Globe, RefreshCw, ExternalLink, Zap, Heart, AlertCircle } from 'lucide-react';

interface LivePreviewProps {
  url?: string;
  isVisible: boolean;
  refreshKey?: number;
  onUrlChange?: (newUrl: string) => void;
}

export default function LivePreview({ url = 'http://localhost:5173', isVisible, refreshKey, onUrlChange }: LivePreviewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [editUrl, setEditUrl] = useState(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setEditUrl(url);
  }, [url]);

  const reload = () => {
    setLoading(true);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = url;
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onUrlChange) onUrlChange(editUrl);
  };

  useEffect(() => {
    if (isVisible) reload();
  }, [isVisible, refreshKey, url]);

  // Check if URL is reachable
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(url, { mode: 'no-cors' });
        setError(false);
      } catch (e) {
        setError(true);
      }
    };
    if (isVisible) checkStatus();
  }, [url, refreshKey]);

  return (
    <div className={`flex flex-col h-full bg-white transition-all duration-500 overflow-hidden relative ${isVisible ? 'w-full' : 'w-0'}`}>
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 bg-[#f1f5f9] border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3 flex-1">
          <form onSubmit={handleUrlSubmit} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 rounded-lg shadow-sm max-w-md flex-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
            <Globe size={14} className={error ? "text-red-500" : "text-green-500"} />
            <input 
              type="text" 
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              className="text-[11px] font-medium text-gray-600 bg-transparent border-none outline-none w-full"
              spellCheck={false}
            />
          </form>
        </div>
        
        <div className="flex items-center gap-1 ml-4">
          <button 
            onClick={reload}
            className={`p-2 hover:bg-white rounded-lg transition-all text-gray-500 ${loading ? 'animate-spin text-blue-500' : ''}`}
          >
            <RefreshCw size={16} />
          </button>
          <button 
            onClick={() => window.open(url, '_blank')}
            className="p-2 hover:bg-white rounded-lg transition-all text-gray-500"
            title="Yeni pəncərədə aç"
          >
            <ExternalLink size={16} />
          </button>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 relative bg-[#f8fafc] group">
        {error ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white p-8 text-center space-y-4 animate-in fade-in duration-500">
            <div className="w-16 h-16 rounded-3xl bg-red-50 flex items-center justify-center text-red-500">
              <AlertCircle size={32} />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-gray-900">Server Tapılmadı</h4>
              <p className="text-[11px] text-gray-500 max-w-[200px] leading-relaxed">
                Bu URL-də server (məsələn, <b>{url}</b>) işləmir. Zəhmət olmasa URL-i yoxlayın.
              </p>
            </div>
            <button 
              onClick={reload}
              className="px-6 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-black transition-all active:scale-95"
            >
              Yenidən Yoxla
            </button>
          </div>
        ) : (
          <>
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
            />
          </>
        )}

        {/* Watermark — Made with iBahora, Inspired by Bahar */}
        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center pointer-events-none select-none opacity-40 hover:opacity-100 transition-opacity duration-500">
          <div className="px-3 py-1 bg-black/5 backdrop-blur-md rounded-full border border-black/5 flex items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500">Made with iBahora</span>
            <div className="w-1 h-1 rounded-full bg-gray-300" />
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-400">Inspired by</span>
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-pink-500 flex items-center gap-1">
                Bahar <Heart size={8} className="fill-pink-500" />
              </span>
            </div>
          </div>
          
          {!loading && !error && (
             <div className="px-3 py-1 bg-blue-600/10 text-blue-600 text-[9px] font-black uppercase tracking-widest rounded-full flex items-center gap-1.5">
                <Zap size={10} className="fill-blue-600" /> Live
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
