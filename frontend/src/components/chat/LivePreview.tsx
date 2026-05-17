// ==========================================
// LivePreview — Smart Iframe Component
// ==========================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCcw, ExternalLink, Globe, AlertCircle, Loader2, Maximize2, Minimize2 } from 'lucide-react';

interface LivePreviewProps {
  url: string;
  isVisible: boolean;
  onClose?: () => void;
  onUrlChange?: (url: string) => void;
  refreshKey?: number;
}

export default function LivePreview({ url, isVisible, onClose, onUrlChange, refreshKey }: LivePreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [editUrl, setEditUrl] = useState(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setEditUrl(url);
  }, [url]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = url;
    }
  }, [url]);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onUrlChange) onUrlChange(editUrl);
  };

  useEffect(() => {
    if (isVisible) reload();
  }, [isVisible, refreshKey, reload]);

  // Check if URL is reachable
  useEffect(() => {
    const checkStatus = async () => {
      try {
        await fetch(url, { mode: 'no-cors' });
        setError(false);
      } catch {
        setError(true);
      }
    };
    if (isVisible) checkStatus();
  }, [url, refreshKey, isVisible]);

  return (
    <div className={`flex flex-col h-full bg-white transition-all duration-500 overflow-hidden relative ${isVisible ? 'w-full' : 'w-0'}`}>
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 bg-[#f1f5f9] border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3 flex-1">
          <form onSubmit={handleUrlSubmit} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 rounded-lg shadow-sm max-w-md flex-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
            <Globe size={14} className="text-gray-400" />
            <input 
              type="text" 
              value={editUrl} 
              onChange={e => setEditUrl(e.target.value)}
              className="flex-1 bg-transparent text-xs text-gray-700 outline-none"
              placeholder="Preview URL..."
            />
          </form>
          
          <div className="flex items-center gap-1 ml-2">
            <button 
              onClick={reload}
              className="p-1.5 hover:bg-gray-200 rounded-md transition-colors text-gray-500"
              title="Refresh"
            >
              <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <a 
              href={url} 
              target="_blank" 
              rel="noreferrer"
              className="p-1.5 hover:bg-gray-200 rounded-md transition-colors text-gray-500"
              title="Open in new tab"
            >
              <ExternalLink size={14} />
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4">
          <button 
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors text-gray-500"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          {onClose && (
            <button 
              onClick={onClose}
              className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded-lg text-xs font-bold transition-all text-gray-700"
            >
              Bağla
            </button>
          )}
        </div>
      </div>

      {/* Main Preview */}
      <div className="flex-1 relative bg-white">
        {loading && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10">
            <Loader2 size={32} className="text-blue-500 animate-spin mb-4" />
            <p className="text-xs text-gray-500 font-medium animate-pulse">Preview hazırlanır...</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 z-20 px-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Preview-a qoşulmaq mümkün olmadı</h3>
            <p className="text-xs text-gray-500 max-w-xs mb-8">
              Serverin {url} ünvanında işlədiyindən əmin olun. Əgər hələ başlamayıbsa, agentin serveri başlatmasını gözləyin.
            </p>
            <button 
              onClick={reload}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-xl shadow-blue-600/20 transition-all active:scale-95"
            >
              YENİDƏN YOXLA
            </button>
          </div>
        )}

        <iframe 
          ref={iframeRef}
          src={url}
          className={`w-full h-full border-none transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
          onLoad={() => setLoading(false)}
          onError={() => setError(true)}
          sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
        />
      </div>

      {/* Status Bar */}
      <div className="h-6 bg-[#f8fafc] border-t border-gray-200 flex items-center px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${error ? 'bg-red-500' : 'bg-green-500 animate-pulse'}`} />
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            {error ? 'Bağlantı Kəsildi' : 'Canlı Önizləmə Aktivdir'}
          </span>
        </div>
      </div>
    </div>
  );
}
