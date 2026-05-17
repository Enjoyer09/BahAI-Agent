// ==========================================
// App — Fully Integrated Workspace-First IDE
// ==========================================

import { useState, useEffect } from 'react';
import { Code, Command, PanelLeft, Monitor } from 'lucide-react';
import Sidebar from './components/sidebar/Sidebar';
import ChatArea from './components/chat/ChatArea';
import ChatInput from './components/chat/ChatInput';
import FileTree from './components/sidebar/FileTree';
import Terminal from './components/chat/Terminal';
import CodeEditor from './components/chat/CodeEditor';
import LivePreview from './components/chat/LivePreview';
import OpsPanel from './components/chat/OpsPanel';
import AuthModal from './components/auth/AuthModal';
import LandingPage from './components/landing/LandingPage';
import { useSettings } from './hooks/useSettings';
import { useChat } from './hooks/useChat';
import { useTheme } from './hooks/useTheme';
import { useAuth } from './hooks/useAuth';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<'projects' | 'files'>('projects');
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showOps, setShowOps] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const { user, loading: authLoading } = useAuth();
  const settings = useSettings();
  const themeCtx = useTheme();
  const chat = useChat(settings.settings, user?.id);

  // Dynamic Layout Logic: Check if any auxiliary window is active
  const isAuxActive = activeFile || showPreview || showTerminal || showOps;

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 1024);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setSidebarMode('projects');
    }
  }, [isMobile]);

  // Auto-toggle preview for web projects if needed
  useEffect(() => {
    if (chat.activeProject?.name?.toLowerCase().includes('site') || 
        chat.activeProject?.name?.toLowerCase().includes('web')) {
      setShowPreview(true);
    }
  }, [chat.activeProject?.id, chat.activeProject?.name]);

  if (authLoading) {
    return <div className="h-screen w-full flex items-center justify-center bg-[#050505] text-blue-500">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
    </div>;
  }

  // If not logged in, show the Landing Page
  if (!user) {
    return (
      <>
        <LandingPage onGetStarted={() => setShowAuthModal(true)} />
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </>
    );
  }

  return (
    <div className="h-screen w-full flex bg-[var(--bg-main)] text-[var(--fg-main)] overflow-hidden font-sans selection:bg-blue-500/30 animate-in fade-in duration-700 relative">
      
      {/* Sidebar */}
      {isMobile && sidebarOpen && (
        <button
          aria-label="Close sidebar backdrop"
          className="absolute inset-0 bg-black/50 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className={isMobile ? 'absolute z-40 h-full' : ''}>
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
      </div>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col relative min-w-0 p-2 lg:py-2 lg:pr-2">
        
        {/* Top Header */}
        <header className="h-14 flex items-center justify-between px-3 lg:px-6 bg-[var(--bg-surface)]/40 backdrop-blur-xl border border-white/5 rounded-2xl lg:rounded-3xl mb-2 shrink-0">
          <div className="flex items-center gap-2 lg:gap-4 min-w-0">
            {(!sidebarOpen || isMobile) && (
              <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-white/5 rounded-xl transition-all">
                <PanelLeft size={20} className="text-blue-500" />
              </button>
            )}
            <div className="flex items-center gap-2 px-2 lg:px-3 py-1.5 bg-white/5 rounded-xl border border-white/5 min-w-0">
              <Code size={14} className="text-blue-400" />
              {!isMobile && <span className="text-[11px] font-black uppercase tracking-widest opacity-60">Workspace</span>}
              <span className="text-[11px] font-black text-blue-400 truncate">{chat.activeProject?.name || 'Seçilməyib'}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 lg:gap-2">
            <button 
              onClick={() => setShowPreview(!showPreview)}
              className={`flex items-center gap-1 lg:gap-2 px-2 lg:px-4 py-2 rounded-xl transition-all border font-bold text-[10px] uppercase tracking-widest ${
                showPreview ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-600/20' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              <Monitor size={14} /> {isMobile ? 'Preview' : (showPreview ? 'Önizləmə Açıq' : 'Önizləmə')}
            </button>
            <button 
              onClick={() => setShowTerminal(!showTerminal)}
              className={`flex items-center gap-1 lg:gap-2 px-2 lg:px-4 py-2 rounded-xl transition-all border font-bold text-[10px] uppercase tracking-widest ${
                showTerminal ? 'bg-white/15 border-white/10 text-white shadow-xl' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              <Command size={14} /> {isMobile ? 'Term' : 'Terminal'}
            </button>
            <button
              onClick={() => setShowOps(!showOps)}
              className={`flex items-center gap-1 lg:gap-2 px-2 lg:px-4 py-2 rounded-xl transition-all border font-bold text-[10px] uppercase tracking-widest ${
                showOps ? 'bg-white/15 border-white/10 text-white shadow-xl' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              Ops
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 flex flex-col lg:flex-row gap-2 min-h-0">
          
          {/* Chat Panel — Dynamic Width */}
          <div className={`flex flex-col bg-[var(--bg-surface)]/40 backdrop-blur-xl border border-white/5 rounded-2xl lg:rounded-[2.5rem] overflow-hidden transition-all duration-500 ease-in-out min-h-0 ${isMobile ? 'flex-1' : (isAuxActive ? 'w-[450px]' : 'flex-1 mx-20')}`}>
            <ChatArea messages={chat.messages} loading={chat.loading} />
            <ChatInput onSend={chat.sendMessage} loading={chat.loading} onStop={chat.stop} />
          </div>

          {/* Editor/Tree/Preview Group — Only visible if aux is active */}
          {isAuxActive && (
            <div className="flex-1 flex flex-col min-w-0 gap-2 animate-in slide-in-from-right-4 duration-500">
              <div className="flex-1 flex flex-col lg:flex-row gap-2 min-h-0">
                {/* File Tree */}
                {!isMobile && sidebarOpen && sidebarMode === 'files' && chat.activeProject && (
                  <div className="w-64 bg-[var(--bg-surface)]/40 backdrop-blur-xl border border-white/5 rounded-3xl overflow-hidden">
                    <FileTree 
                      projectPath={chat.activeProject.path} 
                      onFileSelect={setActiveFile} 
                      selectedPath={activeFile || undefined}
                    />
                  </div>
                )}

                {/* Central Editor */}
                {activeFile && (
                  <div className="flex-1 bg-[var(--bg-surface)]/60 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-inner">
                    <CodeEditor 
                      filePath={activeFile} 
                      projectDir={chat.activeProject?.path || ''} 
                      onClose={() => setActiveFile(null)} 
                    />
                  </div>
                )}

                {/* Live Preview Panel */}
                {showPreview && (
                  <div className={`bg-white border border-white/10 rounded-2xl lg:rounded-[2.5rem] overflow-hidden shadow-2xl transition-all duration-500 min-h-[320px] ${isMobile ? 'w-full' : (activeFile ? 'w-1/3 min-w-[400px]' : 'flex-1')}`}>
                    <LivePreview 
                      url={`http://localhost:${chat.activeProject?.lastPort || 5173}`} 
                      isVisible={showPreview} 
                      refreshKey={chat.previewKey} 
                      onUrlChange={(newUrl) => {
                        const match = newUrl.match(/http:\/\/localhost:(\d+)/);
                        if (match && match[1]) {
                          const newPort = parseInt(match[1]);
                          chat.updateProjectPort(newPort);
                        }
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Terminal Panel */}
              {showTerminal && (
                <div className="h-56 lg:h-64 bg-[#0a0a0c] border border-white/10 rounded-2xl lg:rounded-3xl overflow-hidden shadow-2xl">
                  <Terminal />
                </div>
              )}
            </div>
          )}

          {showOps && (
            <OpsPanel
              safeMode={chat.safeMode}
              setSafeMode={chat.setSafeMode}
              taskPlan={chat.taskPlan}
              pendingApprovals={chat.pendingApprovals}
              onDecideApproval={chat.decideApproval}
              onHealthCheck={chat.runHealthCheck}
              onTerminalRun={chat.runTerminalCommand}
              onDiffPreview={chat.getDiffPreview}
              onDiffApply={chat.applyDiffPreview}
            />
          )}
        </div>
      </main>

      {/* Auth Modal Overlay (For manual triggers from Workspace) */}
      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
      />
    </div>
  );
}
