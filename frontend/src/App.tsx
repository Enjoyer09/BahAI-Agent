import { useEffect, useState, useCallback } from 'react';
import { Code, Terminal as TermIcon, Settings, ExternalLink, PanelRight, X } from 'lucide-react';
import ChatArea from './components/chat/ChatArea';
import ChatInput from './components/chat/ChatInput';
import CodeEditor from './components/chat/CodeEditor';
import LivePreview from './components/chat/LivePreview';
import OpsPanel from './components/chat/OpsPanel';
import Terminal from './components/chat/Terminal';
import AuthModal from './components/auth/AuthModal';
import Sidebar from './components/sidebar/Sidebar';
import FileTree from './components/sidebar/FileTree';
import { useAuth } from './hooks/useAuth';
import { useChat } from './hooks/useChat';
import { useTheme } from './hooks/useTheme';
import { useSettings } from './hooks/useSettings';
import { ThemeToggle } from './components/common/ThemeToggle';
import { ToastProvider, useConfirm } from './components/common/Toast';

function AppContent() {
  const auth = useAuth();
  const settings = useSettings();
  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<'chat' | 'files'>('chat');
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showOps, setShowOps] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { ConfirmDialog } = useConfirm();

  const chat = useChat();

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'b') { e.preventDefault(); setSidebarOpen(p => !p); }
      if (mod && e.key === '`') { e.preventDefault(); setShowTerminal(p => !p); }
      if (mod && e.key === 'j') { e.preventDefault(); setShowEditor(p => !p); }
      if (mod && e.shiftKey && e.key === 'P') { e.preventDefault(); setSidebarMode(m => m === 'files' ? 'chat' : 'files'); setSidebarOpen(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (auth.user && !auth.loading) setAuthModalOpen(false);
  }, [auth.user, auth.loading]);

  const handleFileSelect = useCallback((path: string) => {
    chat.setSelectedFile?.(path);
    setShowEditor(true);
  }, [chat]);

  if (auth.loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--bg-main)' }}>
        <div className="animate-pulse-glow w-12 h-12 rounded-full flex items-center justify-center"
             style={{ border: '2px solid var(--color-accent)', borderTopColor: 'transparent' }}>
          <Code size={20} style={{ color: 'var(--color-accent)' }} />
        </div>
      </div>
    );
  }

  const autoPreview = chat.activeProject?.name?.match(/site|web|app|frontend|ui/i);

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-main)' }}>
      {/* HEADER */}
      <header
        className="h-12 flex items-center justify-between px-4 shrink-0 z-20"
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-3">
          <Sidebar
            isOpen={sidebarOpen}
            onToggle={() => setSidebarOpen(!sidebarOpen)}
            mode={sidebarMode}
            onModeChange={setSidebarMode}
            chat={chat}
            onAuthClick={() => setAuthModalOpen(true)}
          />

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent)' }}>
              <Code size={14} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate" style={{ color: 'var(--fg-main)' }}>
                {chat.activeProject?.name || 'bahAI'}
              </div>
              <div className="text-[10px] truncate" style={{ color: 'var(--fg-muted)' }}>
                {chat.activeProject?.path ? chat.activeProject.path.split('/').pop() : 'No project'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {chat.activeProject?.repoUrl && (
            <a
              href={chat.activeProject.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md transition-colors"
              style={{ color: 'var(--fg-muted)' }}
              title="Open in GitHub"
            >
              <ExternalLink size={14} />
            </a>
          )}

          {autoPreview && (
            <button
              onClick={() => setShowPreview(p => !p)}
              className="p-1.5 rounded-md transition-colors"
              style={{
                color: showPreview ? 'var(--color-accent)' : 'var(--fg-muted)',
                background: showPreview ? 'var(--color-accent-muted)' : 'transparent',
              }}
              title="Toggle Preview"
            >
              <PanelRight size={14} />
            </button>
          )}

          <button
            onClick={() => setShowTerminal(p => !p)}
            className="p-1.5 rounded-md transition-colors"
            style={{
              color: showTerminal ? 'var(--color-accent)' : 'var(--fg-muted)',
              background: showTerminal ? 'var(--color-accent-muted)' : 'transparent',
            }}
            title="Toggle Terminal"
          >
            <TermIcon size={14} />
          </button>

          <button
            onClick={() => setShowOps(p => !p)}
            className="p-1.5 rounded-md transition-colors"
            style={{
              color: showOps ? 'var(--color-accent)' : 'var(--fg-muted)',
              background: showOps ? 'var(--color-accent-muted)' : 'transparent',
            }}
            title="Toggle Ops"
          >
            <Settings size={14} />
          </button>

          <div className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
          <ThemeToggle />
        </div>
      </header>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex overflow-hidden">
        {/* SIDEBAR / FILE TREE */}
        {sidebarOpen && (
          <aside
            className="flex flex-col shrink-0 overflow-hidden"
            style={{
              width: isMobile ? '85vw' : sidebarMode === 'files' ? '260px' : '280px',
              maxWidth: isMobile ? '320px' : undefined,
              background: 'var(--bg-surface)',
              borderRight: '1px solid var(--border)',
            }}
          >
            {sidebarMode === 'files' && chat.activeProject ? (
              <FileTree
                projectPath={chat.activeProject.path}
                onFileSelect={handleFileSelect}
              />
            ) : null}
          </aside>
        )}

        {/* CHAT AREA */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <ChatArea
            messages={chat.messages}
            loading={chat.loading}
            onSend={chat.sendMessage}
            onStop={chat.stopGeneration}
            pendingApprovals={chat.pendingApprovals}
            onApprove={chat.decideApproval}
          />
          <ChatInput
            onSend={chat.sendMessage}
            onStop={chat.stopGeneration}
            loading={chat.loading}
            safeMode={chat.safeMode}
            onSafeModeToggle={chat.toggleSafeMode}
          />
        </main>

        {/* AUX PANELS */}
        {showEditor && (
          <div
            className="flex flex-col shrink-0 overflow-hidden animate-in-right"
            style={{
              width: isMobile ? '100vw' : '480px',
              background: 'var(--bg-surface)',
              borderLeft: '1px solid var(--border)',
            }}
          >
            <div className="flex items-center justify-between h-10 px-3 shrink-0"
                 style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-xs font-medium truncate" style={{ color: 'var(--fg-secondary)' }}>
                {chat.selectedFile?.split('/').pop() || 'Editor'}
              </span>
              <button onClick={() => setShowEditor(false)} className="p-1 rounded"
                      style={{ color: 'var(--fg-muted)' }}>
                <X size={14} />
              </button>
            </div>
            <CodeEditor
              filePath={chat.selectedFile || ''}
              workingDirectory={chat.activeProject?.path || ''}
              onClose={() => setShowEditor(false)}
            />
          </div>
        )}

        {showPreview && (
          <div
            className="flex flex-col shrink-0 overflow-hidden animate-in-right"
            style={{
              width: isMobile ? '100vw' : '420px',
              background: 'var(--bg-surface)',
              borderLeft: '1px solid var(--border)',
            }}
          >
            <LivePreview
              port={chat.activeProject?.lastPort}
              isVisible={showPreview}
              onClose={() => setShowPreview(false)}
            />
          </div>
        )}

        {showOps && (
          <div
            className="shrink-0 overflow-hidden animate-in-right"
            style={{
              width: isMobile ? '100vw' : '340px',
              background: 'var(--bg-surface)',
              borderLeft: '1px solid var(--border)',
            }}
          >
            <OpsPanel
              safeMode={chat.safeMode}
              onToggleSafeMode={chat.toggleSafeMode}
              pendingApprovals={chat.pendingApprovals}
              onApprove={chat.decideApproval}
              taskPlan={chat.taskPlan}
              activeProject={chat.activeProject}
            />
          </div>
        )}
      </div>

      {/* TERMINAL */}
      {showTerminal && (
        <div
          className="shrink-0 overflow-hidden animate-in"
          style={{
            height: '200px',
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border)',
          }}
        >
          <Terminal
            projectPath={chat.activeProject?.path || ''}
            isVisible={showTerminal}
            onClose={() => setShowTerminal(false)}
          />
        </div>
      )}

      {/* STATUS BAR */}
      <footer
        className="h-6 flex items-center justify-between px-3 text-[11px] shrink-0"
        style={{
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border)',
          color: 'var(--fg-muted)',
        }}
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: auth.user ? '#22c55e' : '#ef4444' }} />
            {auth.user ? 'Connected' : 'Offline'}
          </span>
          {chat.activeProject && (
            <span className="truncate max-w-[200px]">{chat.activeProject.path}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span>{settings.model}</span>
          <span>Ctrl+B sidebar</span>
        </div>
      </footer>

      {/* MODALS */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      {ConfirmDialog}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
