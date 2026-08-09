import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Code, Terminal as TermIcon, Settings, PanelRight, X, Menu, SquarePen, Keyboard as KeyboardIcon } from 'lucide-react';
import ChatArea from './components/chat/ChatArea';
import KeyboardShortcutsDialog from './components/chat/KeyboardShortcutsDialog';
import { Composer } from './components/chat/Composer';
import VoiceMode, { speechSupported, mediaRecordingSupported } from './components/chat/VoiceMode';
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
import { WORKFLOW_OPTIONS } from './lib/constants';

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
const isElectron = typeof window !== 'undefined'
  && (Boolean((window as any).electron?.isDesktop) || window.navigator.userAgent.includes('Electron'));

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
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showVoiceMode, setShowVoiceMode] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  void setSelectedFile;
  const { ConfirmDialog } = useConfirm();

  const chat = useChat(settings.settings, auth.user?.id);

  // Keep the latest chat handle in a ref so the global keydown listener (which
  // is registered once) never reads a stale createConversation/projects value.
  const chatRef = useRef(chat);
  chatRef.current = chat;

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

  // Keep the mobile composer above the soft keyboard. iOS Safari overlays the
  // keyboard WITHOUT resizing the layout viewport, so the composer dock (pinned
  // to the bottom of the full-height root) ends up hidden behind it. We measure
  // the visualViewport and expose the keyboard height as a CSS var (--kb) that
  // the composer dock translates up by. On Android/Chrome (where the layout
  // viewport resizes, and via interactive-widget=resizes-content), vv.height
  // already equals the visible area, so --kb resolves to 0 and nothing moves.
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${kb}px`);
      // While typing, keep the latest messages visible above the keyboard.
      if (kb > 0 && document.activeElement?.classList?.contains('composer-textarea')) {
        const scroller = document.querySelector<HTMLElement>('.mobile-chat-scroll');
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      }
    };
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    apply();
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      document.documentElement.style.removeProperty('--kb');
    };
  }, [isMobile]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable = Boolean(
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      );
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'b') { e.preventDefault(); setSidebarOpen(p => !p); }
      if (mod && e.key === '`') { e.preventDefault(); setShowTerminal(p => !p); }
      if (mod && e.key === 'j') { e.preventDefault(); setShowEditor(p => !p); }
      if (mod && e.key === '/') { e.preventDefault(); setShowShortcuts(p => !p); }
      if (e.key === '?' && !mod && !isEditable) { setShowShortcuts(p => !p); }
      // Focus the message composer
      if (mod && e.key.toLowerCase() === 'k' && !isEditable) {
        e.preventDefault();
        document.querySelector<HTMLTextAreaElement>('.composer-textarea')?.focus();
      }
      // New chat
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const current = chatRef.current;
        const projectId = current.activeProject?.id || current.projects?.[0]?.id;
        if (projectId) current.createConversation(projectId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const electron = (window as any).electron;
    const disposeSettings = electron?.onOpenSettings?.(() => {
      window.dispatchEvent(new CustomEvent('bahai-open-settings'));
    });
    const disposeNewChat = electron?.onNewChat?.(() => {
      const projectId = chat.activeProject?.id || chat.projects?.[0]?.id;
      if (projectId) chat.createConversation(projectId);
    });
    return () => {
      disposeSettings?.();
      disposeNewChat?.();
    };
  }, [chat.activeProject?.id, chat.createConversation, chat.projects]);

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
  const isDesktopProduct = settings.productMode === 'desktop_code';
  const allowDesktopAuxPanels = isDesktopProduct;

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

      {/* MOBILE SIDEBAR DRAWER */}
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
              width: 'min(86vw, 360px)',
              background: 'var(--bg-surface)',
              borderRight: '1px solid var(--border)',
              boxShadow: '24px 0 64px rgba(0,0,0,0.3)',
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
            <button
              onClick={() => setShowShortcuts(p => !p)}
              className="p-2.5 rounded-lg transition-colors"
              style={{
                color: showShortcuts ? 'var(--color-accent)' : 'var(--fg-muted)',
                background: showShortcuts ? 'var(--color-accent-muted)' : 'var(--bg-surface)',
              }}
              title="Klaviatura qısayolları (Ctrl+/)"
            >
              <KeyboardIcon size={16} />
            </button>
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
          <div className="mobile-topbar safe-top">
            <div className="mobile-topbar-side">
              <button
                onClick={() => setSidebarOpen(true)}
                className="mobile-topbar-button"
                aria-label="Open menu"
              >
                <Menu size={21} />
              </button>
            </div>
            <div className="mobile-topbar-title">
              <strong>BahAI</strong>
              <span>{chat.activeConversation?.title || 'Yeni chat'}</span>
            </div>
            <div className="mobile-topbar-side mobile-topbar-side-right">
              <button
                onClick={() => {
                  if (chat.activeProject) chat.createConversation(chat.activeProject.id);
                  else if (chat.projects && chat.projects.length > 0) chat.createConversation(chat.projects[0].id);
                }}
                className="mobile-topbar-button"
                aria-label="New chat"
                title="Yeni chat"
              >
                <SquarePen size={20} />
              </button>
            </div>
          </div>
        )}

        {isDesktopProduct && !isMobile && (
          <div className="desktop-contextbar">
            <div className="desktop-contextbar-copy">
              <strong>{chat.activeConversation?.title || 'Yeni söhbət'}</strong>
              <span>
                {settings.executionMode === 'local' ? 'Lokal' : 'Cloud'}
                {' · '}
                {settings.aiMode === 'manual' ? settings.model : 'Smart routing'}
                {' · '}
                {settings.orchestrationMode ? (selectedWorkflow?.name || settings.workflow) : 'Tək agent'}
                {chat.activeProject ? ` · ${chat.activeProject.name}` : ''}
                {chat.safeMode ? ' · Təsdiqli icra' : ' · Avtomatik icra'}
              </span>
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
        <div className={isMobile
          ? 'mobile-composer-dock shrink-0 w-full'
          : `desktop-composer-dock shrink-0 w-full ${chat.messages.length === 0 && settings.centerChatInput ? 'max-w-3xl mx-auto mb-auto mt-0' : 'max-w-3xl mx-auto'} ${settings.maximizeChatSpace ? '!max-w-full !px-8' : ''}`
        }>
          <Composer
            onSendMessage={(text, attachments) => {
              chat.sendMessage(text, attachments); 
            }}
            disabled={chat.loading || chat.actionCenterInteractions.length > 0}
            isGenerating={chat.loading}
            onStop={chat.stop}
            settings={settings}
            jobStatus={chat.jobStatus}
            onCancelJob={chat.stop}
            onVoiceMode={undefined}
          />
        </div>

        {/* Voice Mode overlay */}
        {showVoiceMode && (
          <VoiceMode
            onSend={(text) => chat.sendMessage(text)}
            onClose={() => setShowVoiceMode(false)}
            lastAssistantMessage={
              chat.messages.length > 0
                ? [...chat.messages].reverse().find((m) => m.role === 'assistant')?.content
                : undefined
            }
            isLoading={chat.loading}
          />
        )}
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
      <KeyboardShortcutsDialog isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
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
