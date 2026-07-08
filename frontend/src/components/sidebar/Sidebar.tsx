import { useState, useRef, useEffect, useMemo } from 'react';
import {
  FolderPlus,
  FolderOpen,
  Trash2,
  Settings,
  X,
  PlusCircle,
  GitBranch,
  PanelLeftClose,
  LogOut,
  Shield,
  Search,
  SquarePen,
  Sun,
  Moon,
  User,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import type { ReturnTypeUseSettings } from '../../hooks/useSettings';
import type { Project, Conversation } from '../../lib/types';
import { API_BASE_URL } from '../../lib/constants';
import { connectGithub, disconnectGithub, getGithubStatus, listGithubRepos } from '../../lib/api';
import SettingsPanel from './SettingsPanel';
import AdminPanel from './AdminPanel';
import { useToast, useConfirm } from '../common/Toast';
import { Button } from '../common/UI';

interface ChatState {
  projects: Project[];
  conversations: Conversation[];
  conversationsHasMore?: boolean;
  activeConvId: string | null;
  activeProject: Project | null;
  setActiveConvId: (id: string) => void;
  createProject: (name: string, path: string, repoUrl?: string) => any;
  createConversation: (projectId: string) => void;
  loadMoreConversations?: () => Promise<void> | void;
  searchConversations?: (q: string) => Promise<void> | void;
  deleteProject: (id: string) => void;
  archiveProject: (id: string, archived?: boolean) => void;
  deleteConversation: (id: string) => void;
  sendMessage: (text: string) => void;
}

interface ThemeCtx {
  theme: string;
  setTheme: (t: any) => void;
  resolved: 'light' | 'dark';
}

interface Props {
  onToggle: () => void;
  chat: ChatState;
  themeCtx: ThemeCtx;
  settingsCtx: ReturnTypeUseSettings;
  isMobile?: boolean;
}

function formatConversationMeta(timestamp?: number) {
  if (!timestamp) return '';
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'indi';
  if (diffMin < 60) return `${diffMin} dəq`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} saat`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} gün`;
  return new Intl.DateTimeFormat('az-AZ', { day: '2-digit', month: 'short' }).format(new Date(timestamp));
}

function sanitizeConversationPreview(raw?: string) {
  const text = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>~-]+/g, ' ')
    .replace(/\(\s*-?\d+\s*°F\s*\)/gi, '')
    .replace(/\b-?\d+\s*°F\b/gi, '')
    .replace(/\(\s*\d+\s*mph\s*\)/gi, '')
    .replace(/\b\d+\s*mph\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
  return text;
}

function groupByDate(conversations: Conversation[]): { label: string; items: Conversation[] }[] {
  const now = Date.now();
  const day = 86400000;
  const groups: Record<string, Conversation[]> = {
    'Bugün': [],
    'Dünən': [],
    'Son 7 gün': [],
    'Son 30 gün': [],
    'Daha əvvəl': [],
  };

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  for (const conv of sorted) {
    const age = now - conv.updatedAt;
    if (age < day) groups['Bugün'].push(conv);
    else if (age < 2 * day) groups['Dünən'].push(conv);
    else if (age < 7 * day) groups['Son 7 gün'].push(conv);
    else if (age < 30 * day) groups['Son 30 gün'].push(conv);
    else groups['Daha əvvəl'].push(conv);
  }

  return Object.entries(groups)
    .filter(([_, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

export default function Sidebar({ onToggle, chat, themeCtx, settingsCtx, isMobile = false }: Props) {
  const { signOut, user } = useAuth();
  const { setProjectDir, productMode, executionMode } = settingsCtx;
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const isWebProduct = productMode === 'web_chat';
  const isDesktopLocal = productMode === 'desktop_code' && executionMode === 'local';

  const [showSettings, setShowSettings] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'local' | 'remote'>('local');
  const [newProjName, setNewProjName] = useState('');
  const [newProjPath, setNewProjPath] = useState('');
  const [newProjRepo, setNewProjRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [githubRepos, setGithubRepos] = useState<Array<{ id: number; name: string; fullName: string; private: boolean; cloneUrl: string }>>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const safeProjects = Array.isArray(chat.projects) ? chat.projects : [];
  const safeConversations = Array.isArray(chat.conversations) ? chat.conversations : [];
  const activeProjects = safeProjects.filter(p => p && !p.archived);

  const filteredConversations = useMemo(() => safeConversations, [safeConversations]);

  const grouped = useMemo(() => groupByDate(filteredConversations), [filteredConversations]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node) &&
          addBtnRef.current && !addBtnRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      chat.searchConversations?.(searchQuery);
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!showSettings) return;
    getGithubStatus()
      .then((status) => { setGithubConnected(status.connected); setGithubUsername(status.username); })
      .catch(() => { setGithubConnected(false); setGithubUsername(null); });
  }, [showSettings]);

  const loadGithubRepos = async () => {
    try {
      setGithubLoading(true);
      const repos = await listGithubRepos();
      setGithubRepos(repos);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load GitHub repos');
    } finally {
      setGithubLoading(false);
    }
  };

  const handlePickDir = async () => {
    try {
      let chosenPath = '';
      const electron = (window as any).electron;
      
      if (electron && typeof electron.pickDirectory === 'function') {
        chosenPath = await electron.pickDirectory();
      } else {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${API_BASE_URL}/api/pick-directory`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!response.ok) {
          const err = await response.json();
          toast.error(err.error || 'Qovluq seçilə bilmədi');
          return;
        }
        const data = await response.json();
        chosenPath = data.path || '';
      }

      if (chosenPath) {
        setNewProjPath(chosenPath);
        setProjectDir(chosenPath);
        // Auto-set project name from folder name
        const folderName = chosenPath.replace(/\/$/, '').split('/').pop();
        setNewProjName(folderName || '');
        
        // In local mode, auto-create project immediately after picking folder
        if (addMode === 'local') {
          const name = folderName || 'Yeni layihə';
          chat.createProject(name, chosenPath);
          setShowAddModal(false);
          setNewProjName('');
          setNewProjPath('');
        }
      }
    } catch (e) {
      toast.error('Qovluq seçimi zamanı xəta baş verdi.');
    }
  };

  const handleOpenProject = async () => {
    try {
      let chosenPath = '';
      const electron = (window as any).electron;

      if (electron && typeof electron.pickDirectory === 'function') {
        chosenPath = await electron.pickDirectory();
      } else {
        chosenPath = await fetch(`${API_BASE_URL}/api/pick-directory`, {
          headers: localStorage.getItem('auth_token')
            ? { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
            : {}
        }).then(async (response) => {
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Qovluq seçilə bilmədi');
          }
          const data = await response.json();
          return data.path || '';
        });
      }

      if (!chosenPath) return;

      setProjectDir(chosenPath);
      const existingProject = safeProjects.find((project) => project.path === chosenPath);
      if (existingProject) {
        const existingConversation = safeConversations.find((conversation) => conversation.projectId === existingProject.id);
        if (existingConversation) {
          chat.setActiveConvId(existingConversation.id);
          return;
        }
        chat.createConversation(existingProject.id);
        return;
      }

      const folderName = chosenPath.replace(/\/$/, '').split('/').pop() || 'Yeni layihə';
      chat.createProject(folderName, chosenPath);
    } catch (e: any) {
      toast.error(e?.message || 'Layihə açıla bilmədi');
    }
  };

  const handleCreate = () => {
    if (!newProjName) {
      toast.warning('Layihə adı daxil edin.');
      return;
    }
    
    const isDesktop = window.navigator.userAgent.includes('Electron');
    
    // In production web (not desktop), path is auto-generated
    const projPath = (import.meta.env.MODE === 'production' && !isDesktop)
      ? `workspace://${newProjName.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()}`
      : newProjPath;
    
    if (!projPath && addMode === 'local') {
      toast.warning('Layihə yolu daxil edin.');
      return;
    }

    const repoUrl = addMode === 'remote' ? newProjRepo : undefined;
    chat.createProject(newProjName, projPath || `workspace://${newProjName.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()}`, repoUrl || undefined);
    setShowAddModal(false);
    setNewProjName('');
    setNewProjPath('');
    setNewProjRepo('');
  };

  const handleDeleteConversation = async (id: string) => {
    const ok = await confirm('Bu söhbəti silmək istədiyinizə əminsiniz?', 'Söhbəti sil', 'danger');
    if (ok) chat.deleteConversation(id);
  };

  const handleNewChat = () => {
    if (chat.activeProject) {
      chat.createConversation(chat.activeProject.id);
    } else if (activeProjects.length > 0) {
      chat.createConversation(activeProjects[0].id);
    } else if (isWebProduct && safeProjects.length > 0) {
      chat.createConversation(safeProjects[0].id);
    } else {
      setAddMode('local');
      setShowAddModal(true);
    }
  };

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Top: New chat + Close */}
        <div className="px-3 pb-2 shrink-0 flex items-center justify-between" style={{ paddingTop: isMobile ? '18px' : '50px' }}>
          <button
            onClick={handleNewChat}
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              color: 'var(--fg-main)',
              background: 'transparent',
              border: '1px solid var(--border)',
              minHeight: '44px',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <SquarePen size={18} />
            {isWebProduct ? 'Yeni chat' : 'Yeni söhbət'}
          </button>
          <button
            onClick={onToggle}
            className="p-2.5 rounded-lg transition-colors"
            style={{ color: 'var(--fg-muted)', minHeight: '44px', minWidth: '44px' }}
            aria-label="Close sidebar"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        {isMobile && (
          <div className="px-3 pb-2 shrink-0">
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
            >
              <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--fg-main)' }}>
                {isWebProduct ? 'BahAI Cloud' : (chat.activeProject?.name || 'bahAI')}
              </div>
              <div className="text-[11px] truncate" style={{ color: 'var(--fg-muted)' }}>
                {isWebProduct ? 'Chat history və assistant ayarları' : (chat.activeProject?.path || 'Hələ qovluq açılmayıb')}
              </div>
            </div>
          </div>
        )}

        {!isWebProduct && (
          <div className="px-3 pb-2 shrink-0">
            <button
              onClick={handleOpenProject}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                color: 'var(--fg-main)',
                background: 'transparent',
                border: '1px solid var(--border)',
                minHeight: '44px',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <FolderOpen size={18} />
              Qovluq aç
            </button>
          </div>
        )}

        {/* Search */}
        <div className="px-3 pb-2 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Söhbət axtar..."
              className="w-full pl-9 pr-3 text-sm rounded-lg outline-none"
              style={{
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                color: 'var(--fg-main)',
                minHeight: '44px',
              }}
            />
          </div>
        </div>

        {/* Add project button */}
        {!isWebProduct && (
          <div className="px-3 pb-2 shrink-0 relative">
            <button
              ref={addBtnRef}
              onClick={(e) => { e.stopPropagation(); setShowAddMenu(!showAddMenu); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors"
              style={{ color: 'var(--fg-secondary)', minHeight: '44px' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <PlusCircle size={16} /> Qovluq və ya repo əlavə et
            </button>

            {showAddMenu && (
              <div
                ref={addMenuRef}
                className="absolute left-3 right-3 top-full z-50 rounded-lg overflow-hidden animate-scale-in"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  boxShadow: 'var(--shadow-lg)',
                }}
              >
                {(import.meta.env.MODE !== 'production' || window.navigator.userAgent.includes('Electron')) && (
                  <button
                    onClick={() => { setAddMode('local'); setShowAddModal(true); setShowAddMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors"
                    style={{ color: 'var(--fg-secondary)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <FolderPlus size={14} /> Lokal Qovluq
                  </button>
                )}
                <button
                  onClick={() => { setAddMode('remote'); setShowAddModal(true); setShowAddMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors"
                  style={{ color: 'var(--fg-secondary)', borderTop: '1px solid var(--border)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <GitBranch size={14} /> GitHub Repo
                </button>
              </div>
            )}
          </div>
        )}

        {isDesktopLocal && (
          <div className="px-3 pb-2 shrink-0">
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
            >
              <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--fg-main)' }}>
                Local Desktop
              </div>
              <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                Fayllar, terminal və lokal modellər bu Mac üzərində işləyir.
              </div>
            </div>
          </div>
        )}

        {!isWebProduct && !isDesktopLocal && (
          <div className="px-3 pb-2 shrink-0">
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
            >
              <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--fg-main)' }}>
                Cloud Desktop
              </div>
              <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                Desktop səthindəsiniz, amma reasoning və cavab keyfiyyəti üçün cloud model qatına üstünlük verilir.
              </div>
            </div>
          </div>
        )}

        {/* Conversation list grouped by date */}
        <div className="flex-1 overflow-y-auto premium-scroll px-2 space-y-1">
          {grouped.map(group => (
            <div key={group.label} className="mb-1">
              <div className="px-2 py-2 text-xs font-semibold sticky top-0"
                   style={{ color: 'var(--fg-muted)', background: 'var(--bg-surface)' }}>
                {group.label}
              </div>
              {group.items.map(conv => {
                const isActive = chat.activeConvId === conv.id;
                const project = safeProjects.find((item) => item.id === conv.projectId) || null;
                const projectLabel = isWebProduct ? 'BahAI' : (project?.name || 'Desktop Workspace');
                const isSandbox = projectLabel === 'bahAI Sandbox' || projectLabel === 'BahAI';
                const metaTime = formatConversationMeta(conv.lastMessageAt || conv.updatedAt);
                const preview = sanitizeConversationPreview(conv.preview || '');
                return (
                  <div key={conv.id} className="group relative">
                    <button
                      onClick={() => chat.setActiveConvId(conv.id)}
                      className="w-full flex items-start gap-2 px-3 py-3 pr-14 rounded-[24px] text-left transition-colors"
                      style={{
                        background: isActive ? 'var(--bg-hover)' : 'transparent',
                        color: isActive ? 'var(--fg-main)' : 'var(--fg-secondary)',
                        minHeight: isMobile ? '96px' : '72px',
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="text-sm truncate flex-1 font-medium">{conv.title || (isWebProduct ? 'Adsız chat' : 'Adsız söhbət')}</div>
                          {metaTime && (
                            <span className="text-[10px] shrink-0" style={{ color: 'var(--fg-muted)' }}>
                              {metaTime}
                            </span>
                          )}
                        </div>
                        {preview && (
                          <div
                            className="mt-1 text-[12px] leading-5"
                            style={{
                              color: 'var(--fg-muted)',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              paddingRight: '6px'
                            }}
                          >
                            {preview}
                          </div>
                        )}
                        {typeof conv.messageCount === 'number' && conv.messageCount > 0 && (
                          <div className="mt-1 text-[10px]" style={{ color: 'var(--fg-faint)' }}>
                            {conv.messageCount} mesaj
                          </div>
                        )}
                        {!isWebProduct && (
                          <div className="mt-1 flex items-center gap-2 min-w-0">
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-md truncate tahoe-chip"
                              style={{
                                color: isSandbox ? 'var(--fg-muted)' : 'var(--color-accent)',
                                background: isSandbox ? 'var(--bg-surface)' : 'var(--color-accent-muted)',
                                border: '1px solid var(--border)'
                              }}
                            >
                              {projectLabel}
                            </span>
                          </div>
                        )}
                      </div>
                    </button>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 mobile-visible" style={{ opacity: isMobile ? 1 : undefined }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                        className="p-2 rounded-full transition-colors tahoe-button"
                        style={{
                          color: 'var(--fg-muted)',
                          minHeight: '36px',
                          minWidth: '36px',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border)'
                        }}
                        aria-label="Delete conversation"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {filteredConversations.length === 0 && (
            <div className="text-center py-8">
              <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                {searchQuery ? 'Nəticə tapılmadı' : (isWebProduct ? 'Hələ chat yoxdur' : 'Hələ söhbət yoxdur')}
              </p>
            </div>
          )}

          {!searchQuery && chat.conversationsHasMore && (
            <div className="px-2 py-3">
              <button
                onClick={() => chat.loadMoreConversations?.()}
                className="w-full text-xs rounded-lg px-3 py-2 tahoe-button"
                style={{ color: 'var(--fg-secondary)', background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
              >
                Daha çox yüklə
              </button>
            </div>
          )}
        </div>

        {/* Bottom section */}
        <div className="p-2 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          {/* User info */}
          {user && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1">
              <div className="w-8 h-8 rounded-full flex items-center justify-center"
                   style={{ background: 'var(--color-accent-muted)' }}>
                <User size={16} style={{ color: 'var(--color-accent)' }} />
              </div>
              <span className="text-sm font-medium truncate" style={{ color: 'var(--fg-main)' }}>
                {user.name || user.email}
              </span>
            </div>
          )}

          {/* Theme toggle */}
          {isMobile ? (
            <div className="grid grid-cols-2 gap-2 mb-1">
              <button
                onClick={() => themeCtx.setTheme(themeCtx.resolved === 'dark' ? 'light' : 'dark')}
                className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm transition-colors"
                style={{ color: 'var(--fg-secondary)', background: 'var(--bg-hover)', minHeight: '44px' }}
              >
                {themeCtx.resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                {themeCtx.resolved === 'dark' ? 'İşıqlı' : 'Qaranlıq'}
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm transition-colors"
                style={{ color: 'var(--fg-secondary)', background: 'var(--bg-hover)', minHeight: '44px' }}
              >
                <Settings size={16} /> Parametrlər
              </button>
            </div>
          ) : (
            <button
              onClick={() => themeCtx.setTheme(themeCtx.resolved === 'dark' ? 'light' : 'dark')}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors"
              style={{ color: 'var(--fg-secondary)', minHeight: '44px' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {themeCtx.resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              {themeCtx.resolved === 'dark' ? 'İşıqlı rejim' : 'Qaranlıq rejim'}
            </button>
          )}

          {user && user.role === 'admin' && !window.navigator.userAgent.includes('Electron') && (
            <button
              onClick={() => setShowAdminPanel(true)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors"
              style={{ color: 'var(--fg-secondary)', minHeight: '44px' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Shield size={16} /> Admin
            </button>
          )}

          {!isMobile && (
            <button
              onClick={() => setShowSettings(true)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors"
              style={{ color: 'var(--fg-secondary)', minHeight: '44px' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Settings size={16} /> Parametrlər
            </button>
          )}

          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors"
            style={{ color: 'var(--color-danger)', minHeight: '44px' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <LogOut size={16} /> Çıxış
          </button>
        </div>
      </div>

      {/* Add Project Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--bg-overlay, rgba(0,0,0,0.5))' }} />
          <div
            className="relative w-full max-w-md rounded-2xl p-6 animate-scale-in"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold" style={{ color: 'var(--fg-main)' }}>
                {addMode === 'local' ? 'Yeni Layihə' : 'GitHub-dan idxal et'}
              </h2>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded-md" style={{ color: 'var(--fg-muted)' }}>
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              {addMode === 'local' && (
                <>
                  <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                    Kompüterinizdən layihə qovluğunu seçin
                  </p>
                  <button
                    onClick={handlePickDir}
                    className="w-full px-4 py-3 text-sm rounded-lg font-medium flex items-center justify-center gap-2"
                    style={{ background: 'var(--color-accent)', color: 'var(--fg-on-accent)' }}
                  >
                    <FolderPlus size={16} />
                    Qovluq seç
                  </button>
                </>
              )}

              {addMode === 'remote' && (
                <>
                  <input
                    type="text"
                    value={newProjName}
                    onChange={e => setNewProjName(e.target.value)}
                    placeholder="Layihə adı"
                    className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--fg-main)' }}
                  />
                  <input
                    type="text"
                    value={newProjRepo}
                    onChange={e => setNewProjRepo(e.target.value)}
                    placeholder="https://github.com/user/repo.git"
                    className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--fg-main)' }}
                  />
                  <div className="flex items-center gap-2">
                    <button onClick={loadGithubRepos} className="text-xs px-2 py-1 rounded-md" style={{ background: 'var(--color-accent-muted)', color: 'var(--color-accent)' }}>
                      {githubLoading ? 'Yüklənir...' : 'Repoları yüklə'}
                    </button>
                    {githubConnected && <span className="text-[11px]" style={{ color: 'var(--color-success)' }}>@{githubUsername}</span>}
                  </div>
                  {githubRepos.length > 0 && (
                    <select
                      value={newProjRepo}
                      onChange={e => {
                        setNewProjRepo(e.target.value);
                        if (!newProjName) setNewProjName(e.target.value.split('/').pop()?.replace('.git', '') || '');
                      }}
                      className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                      style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--fg-main)' }}
                    >
                      <option value="">Repo seçin...</option>
                      {githubRepos.map((repo) => (
                        <option key={repo.id} value={repo.cloneUrl}>{repo.fullName} {repo.private ? '🔒' : ''}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <Button variant="ghost" onClick={() => setShowAddModal(false)}>Ləğv et</Button>
              <Button variant="primary" onClick={handleCreate}>Yarat</Button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--bg-overlay, rgba(0,0,0,0.5))' }} />
          <div
            className={`relative w-full ${isMobile ? 'max-w-none self-end rounded-t-2xl rounded-b-none p-4 max-h-[88vh]' : 'max-w-md rounded-2xl p-6 max-h-[85vh]'} animate-scale-in flex flex-col`}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="text-base font-semibold" style={{ color: 'var(--fg-main)' }}>
                {isWebProduct ? 'BahAI Agenti RC1' : 'Parametrlər'}
              </h2>
              <button onClick={() => setShowSettings(false)} className="p-1 rounded-md" style={{ color: 'var(--fg-muted)' }}>
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto premium-scroll space-y-5">
              <SettingsPanel settingsCtx={settingsCtx} />
              {!isWebProduct && (
              <div className="space-y-2">
                <label className="text-xs font-medium" style={{ color: 'var(--fg-muted)' }}>GitHub</label>
                {githubConnected ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--color-success)' }}>@{githubUsername}</span>
                    <Button size="sm" variant="danger" onClick={async () => {
                      try { await disconnectGithub(); setGithubConnected(false); setGithubUsername(null); }
                      catch (e: any) { toast.error(e?.message); }
                    }}>Ayır</Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder="ghp_..."
                      className="flex-1 px-3 py-2 text-sm rounded-lg outline-none"
                      style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--fg-main)' }}
                    />
                    <Button size="sm" variant="primary" onClick={async () => {
                      try {
                        const status = await connectGithub(githubToken.trim());
                        setGithubConnected(Boolean(status.connected));
                        setGithubUsername(status.username);
                        setGithubToken('');
                        toast.success('GitHub bağlandı');
                      } catch (e: any) { toast.error(e?.message); }
                    }}>Bağla</Button>
                  </div>
                )}
              </div>
              )}
            </div>

            <div className="mt-4 pt-4 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
              <Button variant="primary" className="w-full" onClick={() => setShowSettings(false)}>Bitdi</Button>
            </div>
          </div>
        </div>
      )}

      <AdminPanel isOpen={showAdminPanel} onClose={() => setShowAdminPanel(false)} />
      {ConfirmDialog}
    </>
  );
}
