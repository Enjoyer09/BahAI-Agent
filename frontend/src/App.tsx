import { useEffect, useState, lazy, Suspense } from 'react';
import { Code, Terminal as TermIcon, Settings, PanelRight, X, Menu, SquarePen, Mic } from 'lucide-react';
import ChatArea from './components/chat/ChatArea';
import { Composer } from './components/chat/Composer';
import ActionCenterModal from './components/chat/ActionCenterModal';
import AuthModal from './components/auth/AuthModal';
import Sidebar from './components/sidebar/Sidebar';
import LandingPage from './components/landing/LandingPage';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useAuth } from './hooks/useAuth';
import { useChat } from './hooks/useChat';
import { useTheme } from './hooks/useTheme';
import { useSettings } from './hooks/useSettings';
import { ToastProvider, useConfirm } from './components/common/Toast';
import { trackAppOpen } from './lib/telemetry';
import { API_BASE_URL, WORKFLOW_OPTIONS } from './lib/constants';

// P2-FIX: Code-split heavy components that are not needed on initial render
const CodeEditor = lazy(() => import('./components/chat/CodeEditor'));
const LivePreview = lazy(() => import('./components/chat/LivePreview'));
const OpsPanel = lazy(() => import('./components/chat/OpsPanel'));
const Terminal = lazy(() => import('./components/chat/Terminal'));
// Lazy loading fallback
function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full" style={{ background: 'var(--bg-surface)' }}>
      <div className="animate-pulse text-sm" style={{ color: 'var(--fg-muted)' }}>Yüklənir...</div>
    </div>
  );
}

// FUNC-FIX: cache so we only check Electron once and avoid repeatedly hitting
// `window.navigator.userAgent` deep inside render.
const isElectron = typeof window !== 'undefined' && window.navigator.userAgent.includes('Electron');

function AppContent() {
  const auth = useAuth();
  const settings = useSettings();
  const themeCtx = useTheme();
  const [isChat, setIsChat] = useState(() => window.location.pathname === '/chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showOps, setShowOps] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  void setSelectedFile;
  const { ConfirmDialog } = useConfirm();

  const chat = useChat(settings.settings, auth.user?.id);

  useEffect(() => { 
    trackAppOpen(); 
  }, []);

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

  useEffect(() => {
    const handleAuthExpired = () => {
      setAuthModalOpen(true);
    };
    window.addEventListener('bahai-auth-expired', handleAuthExpired as EventListener);
    return () => window.removeEventListener('bahai-auth-expired', handleAuthExpired as EventListener);
  }, []);

  // Show auth modal when on /chat but not logged in (online mode only)
  useEffect(() => {
    if (!auth.loading && !auth.user && isChat) {
      // In local mode, user is auto-logged in. Only show modal in online mode.
      const hasToken = !!localStorage.getItem('auth_token');
      const isSignedOut = localStorage.getItem('signed_out') === '1';
      if (!hasToken || isSignedOut) {
        setAuthModalOpen(true);
      }
    }
  }, [auth.user, auth.loading, isChat]);

  // URL routing: /chat shows chat, everything else shows landing
  useEffect(() => {
    const onPopState = () => setIsChat(window.location.pathname === '/chat');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateToChat = () => {
    window.history.pushState({}, '', '/chat');
    setIsChat(true);
  };

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
  const selectedWorkflow = WORKFLOW_OPTIONS.find((item) => item.id === settings.workflow);
  const isWebProduct = settings.productMode === 'web_chat';
  const isDesktopProduct = settings.productMode === 'desktop_code';
  const desktopIsLocal = isDesktopProduct && settings.executionMode === 'local';
  const allowDesktopAuxPanels = isDesktopProduct;
  const browserModeLabel = settings.guiBrowserMode === 'persistent'
    ? 'Chrome Profile'
    : settings.guiBrowserMode === 'bundled'
      ? 'Chrome Testing'
      : 'CDP';

  // Landing page
  if (!isChat) {
    return <LandingPage onGetStarted={navigateToChat} />;
  }

  return (
    <div className="dvh-screen flex overflow-hidden" style={{ background: 'var(--bg-main)' }}>
      {/* Electron Window Drag Handle */}
      {isElectron && (
        <div 
          className="fixed top-0 left-0 right-0 h-7 z-[9999]" 
          style={{ WebkitAppRegion: 'drag', WebkitUserSelect: 'none' } as any}
        />
      )}

      {/* DESKTOP SIDEBAR */}
      {sidebarOpen && !isMobile && (
        <aside
          className="flex flex-col shrink-0 overflow-hidden relative"
          style={{
            width: `${sidebarWidth}px`,
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border)',
          }}
        >
          <Sidebar
            onToggle={() => setSidebarOpen(false)}
            chat={chat}
            themeCtx={themeCtx}
            settingsCtx={settings}
            isMobile={false}
          />
          <div
            className="w-1.5 cursor-col-resize hover:bg-indigo-500 transition-colors absolute right-0 top-0 bottom-0 z-50"
            onMouseDown={(e) => {
              const startX = e.clientX;
              const startWidth = sidebarWidth;
              const onMouseMove = (moveEvent: MouseEvent) => {
                const newWidth = Math.max(200, Math.min(800, startWidth + (moveEvent.clientX - startX)));
                setSidebarWidth(newWidth);
              };
              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
              };
              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            }}
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
              settingsCtx={settings}
              isMobile
            />
          </aside>
        </>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative" style={{ paddingTop: isElectron ? '28px' : 0 }}>
        {/* Floating toolbar — desktop only */}
        {!isMobile && (
          <>
            {!sidebarOpen && (
              <div 
                className="absolute top-2 left-2 z-10 flex items-center safe-top"
                style={{ WebkitAppRegion: 'no-drag' } as any}
              >
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="p-2.5 rounded-lg transition-colors border border-gray-200 dark:border-gray-800 shadow-sm"
                  style={{ color: 'var(--fg-muted)', background: 'var(--bg-surface)' }}
                  title="Open sidebar (Ctrl+B)"
                >
                  <Menu size={18} />
                </button>
              </div>
            )}
            <div 
              className="absolute top-2 right-2 z-10 flex items-center gap-1 safe-top"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
            {allowDesktopAuxPanels && autoPreview && (
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
            {allowDesktopAuxPanels && (
              <>
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
              </>
            )}
          </div>
          </>
        )}

        {/* Mobile top bar */}
        {isMobile && (
          <div className="flex items-center justify-between px-3.5 py-2.5 shrink-0 safe-top gap-2"
               style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg transition-colors active:scale-95"
              style={{ color: 'var(--fg-main)' }}
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>

            <div className="flex items-center gap-2 min-w-0 px-1">
              <div className="relative w-7 h-7 rounded-full overflow-hidden shrink-0 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                <img 
                  src="/assets/bahar_avatar.jpg" 
                  alt="Bahar Avatar" 
                  className="w-full h-full object-cover object-center"
                />
              </div>
              <div className="min-w-0 text-left">
                <div className="text-sm font-extrabold tracking-wide truncate" style={{ color: 'var(--fg-main)' }}>
                  BAH<span style={{ color: '#10b981' }}>AI</span>
                </div>
                <div className="text-[10px] font-medium text-emerald-400 truncate">
                  ✨ Bahar Smart
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => {
                  if (chat.activeProject) chat.createConversation(chat.activeProject.id);
                  else if (chat.projects && chat.projects.length > 0) chat.createConversation(chat.projects[0].id);
                }}
                className="p-2 rounded-lg transition-colors active:scale-95"
                style={{ color: 'var(--fg-main)' }}
                aria-label="New chat"
                title="Yeni chat"
              >
                <SquarePen size={20} />
              </button>
            </div>
          </div>
        )}

        {isDesktopProduct && (
          <div
            className="px-3 sm:px-4 py-2 shrink-0"
            style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}
          >
            <div className={isMobile ? 'max-w-3xl mx-auto flex items-center gap-2 overflow-x-auto no-scrollbar whitespace-nowrap pb-1' : 'max-w-3xl mx-auto flex flex-wrap items-center gap-2'}>
              <span
                className="text-[11px] px-2.5 py-1 rounded-md shrink-0"
                style={{ background: 'var(--bg-hover)', color: 'var(--fg-main)', border: '1px solid var(--border)' }}
              >
                {`Desktop • ${settings.executionMode === 'local' ? 'Local' : 'Cloud'}`}
              </span>
              <span
                className="text-[11px] px-2.5 py-1 rounded-md shrink-0"
                style={{ background: 'var(--bg-hover)', color: 'var(--fg-secondary)', border: '1px solid var(--border)' }}
              >
                {settings.orchestrationMode ? `Workflow: ${selectedWorkflow?.name || settings.workflow}` : 'Workflow off'}
              </span>
              {!desktopIsLocal && (
                <span
                  className="text-[11px] px-2.5 py-1 rounded-md shrink-0"
                  style={{ background: 'var(--bg-hover)', color: 'var(--fg-secondary)', border: '1px solid var(--border)' }}
                >
                  Browser: {browserModeLabel}
                </span>
              )}
              <span
                className="text-[11px] px-2.5 py-1 rounded-md shrink-0"
                style={{
                  background: chat.safeMode ? 'rgba(245, 158, 11, 0.12)' : 'rgba(34, 197, 94, 0.12)',
                  color: chat.safeMode ? '#fbbf24' : '#86efac',
                  border: '1px solid var(--border)'
                }}
              >
                {chat.safeMode ? 'Safe Mode' : 'Auto Execute'}
              </span>
              {chat.activeProject && (
                <span
                  className="text-[11px] px-2.5 py-1 rounded-md truncate max-w-[180px] shrink-0"
                  style={{ background: 'var(--bg-hover)', color: 'var(--fg-muted)', border: '1px solid var(--border)' }}
                  title={chat.activeProject.path}
                >
                  {chat.activeProject.name}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Chat area */}
        <ChatArea
          messages={chat.messages}
          loading={chat.loading}
          onSend={chat.sendMessage}
          onStop={chat.stop}
          onLoadOlderMessages={chat.activeConversation ? () => chat.loadOlderMessages(chat.activeConversation!.id) : undefined}
          canLoadOlderMessages={Boolean(chat.activeConversation?.messagesHasMore)}
          loadingOlderMessages={Boolean(chat.loadingOlderMessages)}
          workingDirectory={chat.activeProject?.path || ''}
          productMode={settings.productMode}
          settings={settings}
          onEdit={chat.editMessage}
          onRegenerate={chat.regenerateMessage}
        />
        <div className={`shrink-0 w-full ${chat.messages.length === 0 && settings.centerChatInput ? 'max-w-3xl mx-auto mb-auto mt-0' : 'max-w-3xl mx-auto px-4 pb-4 pt-2'} ${settings.maximizeChatSpace ? '!max-w-full !px-8' : ''}`}>
          <Composer
            onSendMessage={(text, attachments) => {
              chat.sendMessage(text, attachments); 
            }}
            disabled={chat.loading || chat.actionCenterInteractions.length > 0}
            isGenerating={chat.loading}
            onStop={chat.stop}
            settings={settings}
          />
        </div>
      </main>

      {/* AUX PANELS — fixed overlay on mobile */}
      {allowDesktopAuxPanels && showEditor && (
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
          <ErrorBoundary>
            <Suspense fallback={<LazyFallback />}>
              <CodeEditor
                filePath={selectedFile || ''}
                workingDirectory={chat.activeProject?.path || ''}
                onClose={() => setShowEditor(false)}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {allowDesktopAuxPanels && showPreview && (
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
          <ErrorBoundary>
            <Suspense fallback={<LazyFallback />}>
              <LivePreview
                port={chat.activeProject?.lastPort}
                isVisible={showPreview}
                onClose={() => setShowPreview(false)}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {allowDesktopAuxPanels && showOps && (
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
          <ErrorBoundary>
            <Suspense fallback={<LazyFallback />}>
              <OpsPanel
                safeMode={chat.safeMode}
                onToggleSafeMode={() => chat.setSafeMode(!chat.safeMode)}
                pendingApprovals={chat.pendingApprovals}
                onApprove={chat.decideApproval}
                taskPlan={chat.taskPlan}
                plannerArtifact={chat.plannerArtifact}
                executionArtifacts={chat.executionArtifacts}
                projectMemory={chat.projectMemory}
                activeProject={chat.activeProject}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {/* TERMINAL */}
      {allowDesktopAuxPanels && showTerminal && (
        <div
          className={isMobile ? 'fixed inset-x-0 bottom-0 z-30 flex flex-col animate-in safe-bottom' : 'shrink-0 overflow-hidden animate-in'}
          style={{
            height: isMobile ? '42vh' : '200px',
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border)',
          }}
        >
          {isMobile && (
            <div className="flex items-center justify-between h-11 px-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--fg-secondary)' }}>Terminal</span>
              <button onClick={() => setShowTerminal(false)} className="p-2 rounded" style={{ color: 'var(--fg-muted)' }}>
                <X size={18} />
              </button>
            </div>
          )}
          <ErrorBoundary>
            <Suspense fallback={<LazyFallback />}>
              <Terminal
                projectPath={chat.activeProject?.path || ''}
                isVisible={showTerminal}
                onClose={() => setShowTerminal(false)}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {/* MODALS */}
      <ActionCenterModal
        interactions={chat.actionCenterInteractions}
        history={chat.actionCenterHistory}
        onResolveCheckpoint={chat.resolveHumanCheckpoint}
        onApprove={chat.decideApproval}
      />
      <AuthModal 
        isOpen={authModalOpen} 
        onClose={() => {
          setAuthModalOpen(false);
          // If user closes modal without logging in, redirect to landing page
          if (!auth.user && isChat) {
            window.history.pushState({}, '', '/');
            setIsChat(false);
          }
        }} 
        productMode={settings.productMode} 
      />
      {ConfirmDialog}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </ErrorBoundary>
  );
}
