import { useEffect, useState } from 'react';
import { Code, Terminal as TermIcon, Settings, PanelRight, X, Menu, SquarePen } from 'lucide-react';
import ChatArea from './components/chat/ChatArea';
import ChatInput from './components/chat/ChatInput';
import CodeEditor from './components/chat/CodeEditor';
import LivePreview from './components/chat/LivePreview';
import OpsPanel from './components/chat/OpsPanel';
import Terminal from './components/chat/Terminal';
import AuthModal from './components/auth/AuthModal';
import Sidebar from './components/sidebar/Sidebar';
import LandingPage from './components/landing/LandingPage';
import { useAuth } from './hooks/useAuth';
import { useChat } from './hooks/useChat';
import { useTheme } from './hooks/useTheme';
import { useSettings } from './hooks/useSettings';
import { ToastProvider, useConfirm } from './components/common/Toast';

function AppContent() {
  const auth = useAuth();
  const settings = useSettings();
  const themeCtx = useTheme();
  const [showLanding, setShowLanding] = useState(() => {
    return !localStorage.getItem('skip_landing');
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showOps, setShowOps] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  void setSelectedFile;
  const { ConfirmDialog } = useConfirm();

  const chat = useChat(settings.settings, auth.user?.id);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'b') { e.preventDefault(); setSidebarOpen(p => !p); }
      if (mod && e.key === '`') { e.preventDefault(); setShowTerminal(p => !p); }
      if (mod && e.key === 'j') { e.preventDefault(); setShowEditor(p => !p); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (auth.user && !auth.loading) setAuthModalOpen(false);
  }, [auth.user, auth.loading]);

  if (auth.loading) {
    return (
      <div className="dvh-screen flex items-center justify-center" style={{ background: 'var(--bg-main)' }}>
        <div className="animate-pulse-glow w-12 h-12 rounded-full flex items-center justify-center"
             style={{ border: '2px solid var(--color-accent)', borderTopColor: 'transparent' }}>
          <Code size={20} style={{ color: 'var(--color-accent)' }} />
        </div>
      </div>
    );
  }

  const autoPreview = chat.activeProject?.name?.match(/site|web|app|frontend|ui/i);

  // Landing page
  if (showLanding) {
    return (
      <LandingPage
        onGetStarted={() => {
          localStorage.setItem('skip_landing', '1');
          setShowLanding(false);
        }}
      />
    );
  }

  return (
    <div className="dvh-screen flex overflow-hidden" style={{ background: 'var(--bg-main)' }}>
      {/* DESKTOP SIDEBAR */}
      {sidebarOpen && !isMobile && (
        <aside
          className="flex flex-col shrink-0 overflow-hidden"
          style={{
            width: '280px',
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border)',
          }}
        >
          <Sidebar
            onToggle={() => setSidebarOpen(false)}
            chat={chat}
            themeCtx={themeCtx}
          />
        </aside>
      )}

      {/* MOBILE SIDEBAR OVERLAY — FULL SCREEN */}
      {sidebarOpen && isMobile && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden animate-slide-in-left safe-top safe-bottom"
            style={{
              width: '100vw',
              background: 'var(--bg-surface)',
            }}
          >
            <Sidebar
              onToggle={() => setSidebarOpen(false)}
              chat={chat}
              themeCtx={themeCtx}
            />
          </aside>
        </>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Floating toolbar — desktop only */}
        {!isMobile && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 safe-top">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2.5 rounded-lg transition-colors"
                style={{ color: 'var(--fg-muted)', background: 'var(--bg-surface)' }}
                title="Open sidebar (Ctrl+B)"
              >
                <Menu size={18} />
              </button>
            )}
            {autoPreview && (
              <button
                onClick={() => setShowPreview(p => !p)}
                className="p-2.5 rounded-lg transition-colors"
                style={{
                  color: showPreview ? 'var(--color-accent)' : 'var(--fg-muted)',
                  background: showPreview ? 'var(--color-accent-muted)' : 'var(--bg-surface)',
                }}
                title="Toggle Preview"
              >
                <PanelRight size={16} />
              </button>
            )}
            <button
              onClick={() => setShowTerminal(p => !p)}
              className="p-2.5 rounded-lg transition-colors"
              style={{
                color: showTerminal ? 'var(--color-accent)' : 'var(--fg-muted)',
                background: showTerminal ? 'var(--color-accent-muted)' : 'var(--bg-surface)',
              }}
              title="Toggle Terminal (Ctrl+`)"
            >
              <TermIcon size={16} />
            </button>
            <button
              onClick={() => setShowOps(p => !p)}
              className="p-2.5 rounded-lg transition-colors"
              style={{
                color: showOps ? 'var(--color-accent)' : 'var(--fg-muted)',
                background: showOps ? 'var(--color-accent-muted)' : 'var(--bg-surface)',
              }}
              title="Toggle Ops"
            >
              <Settings size={16} />
            </button>
          </div>
        )}

        {/* Mobile top bar */}
        {isMobile && (
          <div className="flex items-center justify-between px-3 py-2 shrink-0 safe-top"
               style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2.5 rounded-lg transition-colors"
              style={{ color: 'var(--fg-main)' }}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-medium truncate mx-2" style={{ color: 'var(--fg-main)' }}>
              bahAI
            </span>
            <button
              onClick={() => {
                if (chat.activeProject) chat.createConversation(chat.activeProject.id);
              }}
              className="p-2.5 rounded-lg transition-colors"
              style={{ color: 'var(--fg-main)' }}
              aria-label="New chat"
            >
              <SquarePen size={20} />
            </button>
          </div>
        )}

        {/* Chat area */}
        <ChatArea
          messages={chat.messages}
          loading={chat.loading}
          onSend={chat.sendMessage}
          onStop={chat.stop}
          pendingApprovals={chat.pendingApprovals}
          onApprove={chat.decideApproval}
        />
        <ChatInput
          onSend={chat.sendMessage}
          onStop={chat.stop}
          loading={chat.loading}
          safeMode={chat.safeMode}
          onSafeModeToggle={() => chat.setSafeMode(!chat.safeMode)}
          model={isMobile ? undefined : settings.model}
          onModelChange={isMobile ? undefined : settings.setModel}
          isMobile={isMobile}
        />
      </main>

      {/* AUX PANELS — fixed overlay on mobile */}
      {showEditor && (
        <div
          className={isMobile
            ? 'fixed inset-0 z-30 flex flex-col animate-in-right'
            : 'flex flex-col shrink-0 overflow-hidden animate-in-right'
          }
          style={{
            width: isMobile ? undefined : '480px',
            background: 'var(--bg-surface)',
            borderLeft: isMobile ? undefined : '1px solid var(--border)',
          }}
        >
          <div className="flex items-center justify-between h-12 px-4 shrink-0 safe-top"
               style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-sm font-medium truncate" style={{ color: 'var(--fg-secondary)' }}>
              {selectedFile?.split('/').pop() || 'Editor'}
            </span>
            <button onClick={() => setShowEditor(false)} className="p-2 rounded"
                    style={{ color: 'var(--fg-muted)' }}>
              <X size={18} />
            </button>
          </div>
          <CodeEditor
            filePath={selectedFile || ''}
            workingDirectory={chat.activeProject?.path || ''}
            onClose={() => setShowEditor(false)}
          />
        </div>
      )}

      {showPreview && (
        <div
          className={isMobile
            ? 'fixed inset-0 z-30 flex flex-col animate-in-right'
            : 'flex flex-col shrink-0 overflow-hidden animate-in-right'
          }
          style={{
            width: isMobile ? undefined : '420px',
            background: 'var(--bg-surface)',
            borderLeft: isMobile ? undefined : '1px solid var(--border)',
          }}
        >
          <div className="flex items-center justify-between h-12 px-4 shrink-0 safe-top"
               style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-sm font-medium" style={{ color: 'var(--fg-secondary)' }}>Preview</span>
            <button onClick={() => setShowPreview(false)} className="p-2 rounded"
                    style={{ color: 'var(--fg-muted)' }}>
              <X size={18} />
            </button>
          </div>
          <LivePreview
            port={chat.activeProject?.lastPort}
            isVisible={showPreview}
            onClose={() => setShowPreview(false)}
          />
        </div>
      )}

      {showOps && (
        <div
          className={isMobile
            ? 'fixed inset-0 z-30 flex flex-col animate-in-right'
            : 'shrink-0 overflow-hidden animate-in-right'
          }
          style={{
            width: isMobile ? undefined : '340px',
            background: 'var(--bg-surface)',
            borderLeft: isMobile ? undefined : '1px solid var(--border)',
          }}
        >
          <div className="flex items-center justify-between h-12 px-4 shrink-0 safe-top"
               style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-sm font-medium" style={{ color: 'var(--fg-secondary)' }}>Ops</span>
            <button onClick={() => setShowOps(false)} className="p-2 rounded"
                    style={{ color: 'var(--fg-muted)' }}>
              <X size={18} />
            </button>
          </div>
          <OpsPanel
            safeMode={chat.safeMode}
            onToggleSafeMode={() => chat.setSafeMode(!chat.safeMode)}
            pendingApprovals={chat.pendingApprovals}
            onApprove={chat.decideApproval}
            taskPlan={chat.taskPlan}
            activeProject={chat.activeProject}
          />
        </div>
      )}

      {/* TERMINAL */}
      {showTerminal && (
        <div
          className="shrink-0 overflow-hidden animate-in"
          style={{
            height: isMobile ? '140px' : '200px',
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
