import { useState, useRef, useEffect } from 'react';
import {
  FolderPlus,
  Trash2,
  Settings,
  X,
  PlusCircle,
  Archive,
  GitBranch,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  LogOut,
  Shield,
  MessageSquare,
  FolderOpen,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import type { Project, Conversation } from '../../lib/types';
import { API_BASE_URL } from '../../lib/constants';
import { connectGithub, disconnectGithub, getGithubStatus, listGithubRepos } from '../../lib/api';
import SettingsPanel from './SettingsPanel';
import ThemeToggle from '../common/ThemeToggle';
import AdminPanel from './AdminPanel';
import { useToast, useConfirm } from '../common/Toast';
import { Button } from '../common/UI';

interface ChatState {
  projects: Project[];
  conversations: Conversation[];
  activeConvId: string | null;
  activeProject: Project | null;
  onSelectConv: (id: string) => void;
  onCreateProject: (name: string, path: string, repoUrl?: string) => any;
  onCreateConversation: (projectId: string) => void;
  onDeleteProject: (id: string) => void;
  onArchiveProject: (id: string, archived?: boolean) => void;
  onDeleteConv: (id: string) => void;
  sendMessage: (text: string) => void;
}

interface Props {
  isOpen: boolean;
  onToggle: () => void;
  mode: 'chat' | 'files';
  onModeChange: (mode: 'chat' | 'files') => void;
  chat: ChatState;
  onAuthClick: () => void;
}

export default function Sidebar({ isOpen, onToggle, mode, onModeChange, chat, onAuthClick }: Props) {
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
  const [isProjectsExpanded, setIsProjectsExpanded] = useState(true);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const safeProjects = Array.isArray(chat.projects) ? chat.projects : [];
  const safeConversations = Array.isArray(chat.conversations) ? chat.conversations : [];
  const activeProjects = safeProjects.filter(p => p && !p.archived);

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
    chat.onCreateProject(newProjName, newProjPath, addMode === 'remote' ? newProjRepo : undefined);
    setShowAddModal(false);
    setNewProjName('');
    setNewProjPath('');
    setNewProjRepo('');
    setIsProjectsExpanded(true);
  };

  const handleDeleteProject = async (id: string) => {
    const ok = await confirm('Are you sure you want to delete this project?', 'Delete Project', 'danger');
    if (ok) chat.onDeleteProject(id);
  };

  if (!isOpen) {
    return (
      <div className="flex flex-col items-center py-2 gap-2">
        <button
          onClick={onToggle}
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'var(--fg-muted)' }}
          aria-label="Open sidebar"
        >
          <PanelLeftClose size={18} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button
          onClick={() => { setAddMode('local'); setShowAddModal(true); }}
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'var(--color-accent)' }}
          aria-label="Add project"
        >
          <PlusCircle size={18} />
        </button>
      </div>
    );
  }

  return (
    <>
      <aside
        className="flex flex-col h-full overflow-hidden"
        style={{ background: 'var(--bg-surface-alt)', borderRight: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="h-12 flex items-center justify-between px-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold" style={{ color: 'var(--fg-main)' }}>Projects</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--fg-faint)', color: 'var(--fg-muted)' }}>
              {activeProjects.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              ref={addBtnRef}
              onClick={(e) => { e.stopPropagation(); setShowAddMenu(!showAddMenu); }}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: 'var(--color-accent)' }}
              aria-label="Add project"
              aria-haspopup="true"
              aria-expanded={showAddMenu}
            >
              <PlusCircle size={14} />
            </button>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: 'var(--fg-muted)' }}
              aria-label="Close sidebar"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>

          {/* Add menu dropdown */}
          {showAddMenu && (
            <div
              ref={addMenuRef}
              className="absolute right-2 top-10 z-50 rounded-lg overflow-hidden animate-scale-in"
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

        {/* Project list */}
        <div className="flex-1 overflow-y-auto premium-scroll p-2 space-y-0.5">
          {activeProjects.map(project => {
            if (!project) return null;
            const isActive = chat.activeProject?.id === project.id;

            return (
              <div key={project.id} className="group relative">
                <button
                  onClick={() => {
                    const conv = safeConversations.find(c => c && c.projectId === project.id);
                    if (conv) chat.onSelectConv(conv.id);
                    else chat.onCreateConversation(project.id);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors"
                  style={{
                    background: isActive ? 'var(--color-accent-muted)' : 'transparent',
                    color: isActive ? 'var(--color-accent)' : 'var(--fg-secondary)',
                    border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                  }}
                >
                  {project.repoUrl ? <GitBranch size={14} /> : <FolderOpen size={14} />}
                  <span className="text-xs font-medium truncate flex-1">{project.name}</span>
                </button>

                {/* Actions on hover */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); chat.onArchiveProject(project.id); }}
                    className="p-1 rounded transition-colors"
                    style={{ color: 'var(--fg-muted)' }}
                    aria-label="Archive project"
                  >
                    <Archive size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id); }}
                    className="p-1 rounded transition-colors"
                    style={{ color: 'var(--color-danger)' }}
                    aria-label="Delete project"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}

          {activeProjects.length === 0 && (
            <div className="text-center py-8">
              <FolderOpen size={24} className="mx-auto mb-2" style={{ color: 'var(--fg-faint)' }} />
              <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>No projects yet</p>
              <button
                onClick={() => { setAddMode('local'); setShowAddModal(true); }}
                className="mt-2 text-xs font-medium"
                style={{ color: 'var(--color-accent)' }}
              >
                Create one
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2 space-y-0.5 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
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
            <Settings size={14} /> Settings
          </button>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors"
            style={{ color: 'var(--color-danger)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

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
                {addMode === 'local' ? 'New Project' : 'Import from GitHub'}
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
                placeholder="Project name"
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
                      {githubLoading ? 'Loading...' : 'Load Repos'}
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
                      <option value="">Select repo...</option>
                      {githubRepos.map((repo) => (
                        <option key={repo.id} value={repo.cloneUrl}>{repo.fullName} {repo.private ? '(private)' : ''}</option>
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
                  Browse
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <Button variant="ghost" onClick={() => setShowAddModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreate}>Create</Button>
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
              <h2 className="text-base font-semibold" style={{ color: 'var(--fg-main)' }}>Settings</h2>
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
                    }}>Disconnect</Button>
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
                        toast.success('GitHub connected');
                      } catch (e: any) { toast.error(e?.message); }
                    }}>Connect</Button>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 pt-4 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
              <Button variant="primary" className="w-full" onClick={() => setShowSettings(false)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      <AdminPanel isOpen={showAdminPanel} onClose={() => setShowAdminPanel(false)} />
      {ConfirmDialog}
    </>
  );
}
