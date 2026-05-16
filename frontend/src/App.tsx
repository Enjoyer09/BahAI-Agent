// ==========================================
// App — Fully Integrated Workspace-First IDE
// ==========================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Globe, Code, Command, PanelLeftClose, PanelLeft, LayoutDashboard, Monitor } from 'lucide-react';
import Sidebar from './components/sidebar/Sidebar';
import ChatArea from './components/chat/ChatArea';
import ChatInput from './components/chat/ChatInput';
import FileTree from './components/sidebar/FileTree';
import Terminal from './components/chat/Terminal';
import CodeEditor from './components/chat/CodeEditor';
import LivePreview from './components/chat/LivePreview'; // NEW
import { useSettings } from './hooks/useSettings';
import { useChat } from './hooks/useChat';
import { useTheme } from './hooks/useTheme';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<'projects' | 'files'>('projects');
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showPreview, setShowPreview] = useState(false); // NEW

  const settings = useSettings();
  const themeCtx = useTheme();
  const chat = useChat(settings);

  // Auto-toggle preview for web projects if needed
  useEffect(() => {
    if (chat.activeProject?.name?.toLowerCase().includes('site') || 
        chat.activeProject?.name?.toLowerCase().includes('web')) {
      setShowPreview(true);
    }
  }, [chat.activeProject?.id]);

  return (
    <div className="h-screen w-full flex bg-[var(--bg-main)] text-[var(--fg-main)] overflow-hidden font-sans selection:bg-blue-500/30">
      
      {/* Sidebar */}
      <Sidebar 
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        sidebarMode={sidebarMode}
        setSidebarMode={setSidebarMode}
        projects={chat.projects}
        conversations={chat.conversations}
        activeConvId={chat.activeConvId}
        onSelectConv={chat.setActiveConvId}
        onCreateProject={chat.createProject}
        onCreateConversation={chat.createConversation}
        onDeleteProject={chat.deleteProject}
        onArchiveProject={chat.archiveProject}
        onDeleteConv={chat.deleteConversation}
        sendMessage={chat.sendMessage}
        themeCtx={themeCtx}
        {...settings}
      />

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col relative min-w-0 py-2 pr-2">
        
        {/* Top Header */}
        <header className="h-14 flex items-center justify-between px-6 bg-[var(--bg-surface)]/40 backdrop-blur-xl border border-white/5 rounded-3xl mb-2 shrink-0">
          <div className="flex items-center gap-4">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-white/5 rounded-xl transition-all">
                <PanelLeft size={20} className="text-blue-500" />
              </button>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-xl border border-white/5">
              <Code size={14} className="text-blue-400" />
              <span className="text-[11px] font-black uppercase tracking-widest opacity-60">Workspace</span>
              <span className="text-[11px] font-black text-blue-400">{chat.activeProject?.name || 'Seçilməyib'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowPreview(!showPreview)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all border font-bold text-[10px] uppercase tracking-widest ${
                showPreview ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-600/20' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              <Monitor size={14} /> {showPreview ? 'Önizləmə Açıq' : 'Önizləmə'}
            </button>
            <button 
              onClick={() => setShowTerminal(!showTerminal)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all border font-bold text-[10px] uppercase tracking-widest ${
                showTerminal ? 'bg-white/15 border-white/10 text-white shadow-xl' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              <Command size={14} /> Terminal
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 flex gap-2 min-h-0">
          
          {/* Editor/Tree/Preview Group */}
          <div className="flex-1 flex flex-col min-w-0 gap-2">
            <div className="flex-1 flex gap-2 min-h-0">
              {/* File Tree (Conditional) */}
              {sidebarOpen && sidebarMode === 'files' && chat.activeProject && (
                <div className="w-64 bg-[var(--bg-surface)]/40 backdrop-blur-xl border border-white/5 rounded-3xl overflow-hidden animate-in slide-in-from-left-4 duration-300">
                   <FileTree 
                    projectPath={chat.activeProject.path} 
                    onFileSelect={setActiveFile} 
                    activeFile={activeFile}
                   />
                </div>
              )}

              {/* Central Editor */}
              <div className="flex-1 bg-[var(--bg-surface)]/60 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-inner">
                {activeFile ? (
                  <CodeEditor 
                    filePath={activeFile} 
                    projectDir={chat.activeProject?.path || ''} 
                    onClose={() => setActiveFile(null)} 
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-6">
                    <div className="w-24 h-24 rounded-[2rem] bg-blue-600/10 flex items-center justify-center text-blue-500 animate-bounce-slow">
                      <LayoutDashboard size={48} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-black">iBahora İş Sahəsi</h3>
                      <p className="text-sm text-[var(--fg-muted)] max-w-xs mx-auto leading-relaxed">
                        Sol tərəfdən bir layihə seçin və ya agentə nə etmək istədiyinizi yazın.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Live Preview Panel (NEW) */}
              {showPreview && (
                <div className="w-1/3 min-w-[400px] bg-white border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl animate-in slide-in-from-right-4 duration-500">
                  <LivePreview 
                    url={`http://localhost:${chat.activeProject?.lastPort || 5173}`} 
                    isVisible={showPreview} 
                    refreshKey={chat.previewKey} 
                  />
                </div>
              )}
            </div>

            {/* Terminal Panel */}
            {showTerminal && (
              <div className="h-64 bg-[#0a0a0c] border border-white/10 rounded-3xl overflow-hidden animate-in slide-in-from-bottom-4 duration-300 shadow-2xl">
                <Terminal projectPath={chat.activeProject?.path || ''} />
              </div>
            )}
          </div>

          {/* Chat Side Panel */}
          <div className="w-[450px] flex flex-col bg-[var(--bg-surface)]/40 backdrop-blur-xl border border-white/5 rounded-[2.5rem] overflow-hidden shrink-0">
            <ChatArea messages={chat.messages} loading={chat.loading} />
            <ChatInput onSend={chat.sendMessage} loading={chat.loading} onStop={chat.stop} />
          </div>
        </div>
      </main>
    </div>
  );
}
