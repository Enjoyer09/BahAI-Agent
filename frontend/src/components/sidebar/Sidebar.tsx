import { useState, useRef, useEffect, useMemo } from 'react';
import {
  FolderPlus,
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
  activeConvId: string | null;
  activeProject: Project | null;
  setActiveConvId: (id: string) => void;
  createProject: (name: string, path: string, repoUrl?: string) => any;
  createConversation: (projectId: string) => void;
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

export default function Sidebar({ onToggle, chat, themeCtx }: Props) {
  const { signOut, user } = useAuth();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

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

  // Filter conversations by search
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return safeConversations;
    const q = searchQuery.toLowerCase();
    return safeConversations.filter(c => c.title?.toLowerCase().includes(q));
  }, [safeConversations, searchQuery]);

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
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_BASE_URL}/api/pick-directory`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        const err = await response.json();
        toast.error(err.error || 'Failed to pick directory');
        return;
      }
      const data = await response.json();
      if (data.path) {
        setNewProjPath(data.path);
        if (!newProjName) {
          const folderName = data.path.split('/').pop();
          setNewProjName(folderName || '');
        }
      }
    } catch (e) {
      toast.error('Backend connection failed. Make sure the server is running.');
    }
  };

  const handleCreate = () => {
    if (!newProjName || !newProjPath) {
      toast.warning('Please enter a name and path.');
      return;
    }
    chat.createProject(newProjName, newProjPath, addMode === 'remote' ? newProjRepo : undefined);
    setShowAddModal(false);
    setNewProjName('');
    setNewProjPath('');
    setNewProjRepo('');
  };

  const handleDeleteConversation = async (id: string) => {
    const ok = await confirm('Are you sure you want to delete this conversation?', 'Delete Conversation', 'danger');
    if (ok) chat.deleteConversation(id);
  };

  const handleNewChat = () => {
    if (chat.activeProject) {
      chat.createConversation(chat.activeProject.id);
    } else if (activeProjects.length > 0) {
      chat.createConversation(activeProjects[0].id);
    } else {
      setAddMode('local');
      setShowAddModal(true);
    }
  };

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Top: New chat + Close */}
        <div className="px-3 pt-3 pb-2 shrink-0 flex items-center justify-between">
          <button
            onClick={handleNewChat}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              color: 'var(--fg-main)',
              background: 'transparent',
              border: '1px solid var(--border)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <SquarePen size={16} />
            Yeni söhbət
          </button>
          <button
            onClick={onToggle}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--fg-muted)' }}
            aria-label="Close sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Söhbət axtar..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg outline-none"
              style={{
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                color: 'var(--fg-main)',
              }}
            />
          </div>
        </div>

        {/* Add project button */}
        <div className="px-3 pb-1 shrink-0 relative">
          <button
            ref={addBtnRef}
            onClick={(e) => { e.stopPropagation(); setShowAddMenu(!showAddMenu); }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors"
            style={{ color: 'var(--fg-muted)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <PlusCircle size={14} /> Layihə əlavə et
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
              <button
                onClick={() => { setAddMode('local'); setShowAddModal(true); setShowAddMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors"
                style={{ color: 'var(--fg-secondary)' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <FolderPlus size={14} /> Local Folder
              </button>
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

        {/* Conversation list grouped by date */}
        <div className="flex-1 overflow-y-auto premium-scroll px-2 space-y-1">
          {grouped.map(group => (
            <div key={group.label} className="mb-1">
              <div className="px-2 py-1.5 text-[11px] font-semibold sticky top-0"
                   style={{ color: 'var(--fg-muted)', background: 'var(--bg-surface)' }}>
                {group.label}
              </div>
              {group.items.map(conv => {
                const isActive = chat.activeConvId === conv.id;
                return (
                  <div key={conv.id} className="group relative">
                    <button
                      onClick={() => chat.setActiveConvId(conv.id)}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors truncate"
                      style={{
                        background: isActive ? 'var(--bg-hover)' : 'transparent',
                        color: isActive ? 'var(--fg-main)' : 'var(--fg-secondary)',
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span className="text-sm truncate flex-1">{conv.title || 'Adsız söhbət'}</span>
                    </button>
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                        className="p-1 rounded transition-colors"
                        style={{ color: 'var(--fg-muted)' }}
                        aria-label="Delete conversation"
                      >
                        <Trash2 size={12} />
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
                {searchQuery ? 'Nəticə tapılmadı' : 'Hələ söhbət yoxdur'}
              </p>
            </div>
          )}
        </div>

        {/* Bottom section */}
        <div className="p-2 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          {/* User info */}
          {user && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg mb-1">
              <div className="w-7 h-7 rounded-full flex items-center justify-center"
                   style={{ background: 'var(--color-accent-muted)' }}>
                <User size={14} style={{ color: 'var(--color-accent)' }} />
              </div>
              <span className="text-xs font-medium truncate" style={{ color: 'var(--fg-main)' }}>
                {user.name || user.email}
              </span>
            </div>
          )}

          {/* Theme toggle */}
          <button
            onClick={() => themeCtx.setTheme(themeCtx.resolved === 'dark' ? 'light' : 'dark')}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors"
            style={{ color: 'var(--fg-secondary)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            {themeCtx.resolved === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            {themeCtx.resolved === 'dark' ? 'İşıqlı rejim' : 'Qaranlıq rejim'}
          </button>

          {user && user.role === 'admin' && (
            <button
              onClick={() => setShowAdminPanel(true)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors"
              style={{ color: 'var(--fg-secondary)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Shield size={14} /> Admin
            </button>
          )}

          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors"
            style={{ color: 'var(--fg-secondary)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Settings size={14} /> Parametrlər
          </button>

          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors"
            style={{ color: 'var(--color-danger)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <LogOut size={14} /> Çıxış
          </button>
        </div>
      </div>

      {/* Add Project Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
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
              <input
                type="text"
                value={newProjName}
                onChange={e => setNewProjName(e.target.value)}
                placeholder="Layihə adı"
                className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--fg-main)' }}
              />

              {addMode === 'remote' && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newProjRepo}
                    onChange={e => setNewProjRepo(e.target.value)}
                    placeholder="GitHub URL"
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
                        <option key={repo.id} value={repo.cloneUrl}>{repo.fullName} {repo.private ? '(şəxsi)' : ''}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newProjPath}
                  onChange={e => setNewProjPath(e.target.value)}
                  placeholder="/path/to/project"
                  className="flex-1 px-3 py-2 text-sm rounded-lg outline-none"
                  style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--fg-main)' }}
                />
                <button
                  onClick={handlePickDir}
                  className="px-3 py-2 text-xs rounded-lg font-medium"
                  style={{ background: 'var(--color-accent-muted)', color: 'var(--color-accent)' }}
                >
                  Gözdən keçir
                </button>
              </div>
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
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md rounded-2xl p-6 animate-scale-in max-h-[85vh] flex flex-col"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="text-base font-semibold" style={{ color: 'var(--fg-main)' }}>Parametrlər</h2>
              <button onClick={() => setShowSettings(false)} className="p-1 rounded-md" style={{ color: 'var(--fg-muted)' }}>
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto premium-scroll space-y-5">
              <SettingsPanel />
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
