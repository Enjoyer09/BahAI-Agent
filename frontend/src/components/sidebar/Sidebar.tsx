// ==========================================
// Sidebar — Project & Conversation Management
// ==========================================

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
  PanelLeftClose
} from 'lucide-react';
import type { Project, Conversation } from '../../lib/types';
import type { ThemeMode } from '../../hooks/useTheme';
import { API_BASE_URL } from '../../lib/constants';
import SettingsPanel from './SettingsPanel';
import ThemeToggle from '../common/ThemeToggle';

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarMode: 'projects' | 'files';
  setSidebarMode: (mode: 'projects' | 'files') => void;
  projects: Project[];
  conversations: Conversation[];
  activeConvId: string | null;
  onSelectConv: (id: string) => void;
  onCreateProject: (name: string, path: string, repoUrl?: string) => any;
  onCreateConversation: (projectId: string) => void;
  onDeleteProject: (id: string) => void;
  onArchiveProject: (id: string, archived?: boolean) => void;
  onDeleteConv: (id: string) => void;
  sendMessage: (text: string) => void;
  themeCtx: { theme: ThemeMode; setTheme: (m: ThemeMode) => void };
  apiKey: string;
  setApiKey: (k: string) => void;
  baseUrl: string;
  setBaseUrl: (u: string) => void;
  model: string;
  setModel: (m: string) => void;
  projectDir: string;
  setProjectDir: (d: string) => void;
  performanceMode: boolean;
  setPerformanceMode: (p: boolean) => void;
}

export default function Sidebar(props: SidebarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'local' | 'remote'>('local');
  const [newProjName, setNewProjName] = useState('');
  const [newProjPath, setNewProjPath] = useState('');
  const [newProjRepo, setNewProjRepo] = useState('');
  
  const [isProjectsExpanded, setIsProjectsExpanded] = useState(true);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const safeProjects = Array.isArray(props.projects) ? props.projects : [];
  const safeConversations = Array.isArray(props.conversations) ? props.conversations : [];

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

  const handlePickDir = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/pick-directory`);
      if (!response.ok) {
        const err = await response.json();
        alert(`Xəta: ${err.error || 'Qovluq seçilə bilmədi'}`);
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
      console.error('Picker error:', e);
      alert('Backend ilə rabitə qurulmadı. Serverin işlədiyindən əmin olun.');
    }
  };

  const handleCreate = () => {
    if (!newProjName || !newProjPath) {
      alert('Zəhmət olmasa ad və qovluq yolunu daxil edin.');
      return;
    }
    props.onCreateProject(newProjName, newProjPath, addMode === 'remote' ? newProjRepo : undefined);
    setShowAddModal(false);
    setNewProjName('');
    setNewProjPath('');
    setNewProjRepo('');
    setIsProjectsExpanded(true);
  };

  return (
    <aside className={`flex flex-col bg-[var(--bg-surface-alt)]/80 backdrop-blur-2xl border border-white/5 shadow-2xl transition-all duration-500 relative z-40 rounded-3xl my-2 ml-2 overflow-hidden ${props.sidebarOpen ? 'w-80' : 'w-20'}`}>
      
      {/* Simple Header */}
      <div className={`h-16 flex items-center border-b border-white/5 shrink-0 transition-all px-5 ${props.sidebarOpen ? 'justify-between' : 'justify-center'}`}>
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20 shrink-0 cursor-pointer overflow-hidden" onClick={() => !props.sidebarOpen && props.setSidebarOpen(true)}>
            <span className="text-white font-black text-base leading-none translate-y-[1px]">B</span>
          </div>
          {props.sidebarOpen && (
            <span className="font-bold text-sm tracking-tight truncate animate-in fade-in slide-in-from-left-2 duration-300">iBahora Code</span>
          )}
        </div>
        
        {props.sidebarOpen && (
          <button 
            onClick={() => props.setSidebarOpen(false)}
            className="p-1.5 rounded-lg transition-all hover:bg-white/5 text-[var(--fg-muted)] hover:text-blue-400 active:scale-90"
            title="Yığ"
          >
            <PanelLeftClose size={20} />
          </button>
        )}
      </div>

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6 premium-scroll">
        <div className="space-y-2">
          <div className={`flex items-center mb-2 relative ${props.sidebarOpen ? 'justify-between px-2' : 'justify-center'}`}>
            {props.sidebarOpen && (
              <button 
                onClick={() => setIsProjectsExpanded(!isProjectsExpanded)}
                className="flex items-center gap-2 text-[10px] font-bold text-[var(--fg-muted)] uppercase tracking-widest hover:text-[var(--fg-main)] transition-colors"
              >
                {isProjectsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Projects
              </button>
            )}
            
            <button 
              ref={addBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                setShowAddMenu(!showAddMenu);
              }}
              className={`p-1.5 hover:bg-white/10 rounded-lg transition-all active:scale-90 ${showAddMenu ? 'text-blue-400 bg-white/5' : 'text-blue-400/60'}`}
              title="Yeni Layihə"
            >
              <PlusCircle size={20} />
            </button>
            
            {showAddMenu && (
              <div 
                ref={addMenuRef} 
                className={`absolute ${props.sidebarOpen ? 'right-0 top-10' : 'left-14 top-0'} w-48 bg-[#1a1a1c] border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-150`}
              >
                <button 
                  onClick={() => { setAddMode('local'); setShowAddModal(true); setShowAddMenu(false); }} 
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-xs font-bold hover:bg-blue-600 hover:text-white transition-all group border-b border-white/5"
                >
                  <FolderPlus size={16} className="text-blue-400 group-hover:text-white" /> Local Folder
                </button>
                <button 
                  onClick={() => { setAddMode('remote'); setShowAddModal(true); setShowAddMenu(false); }} 
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-xs font-bold hover:bg-blue-600 hover:text-white transition-all group"
                >
                  <GitBranch size={16} className="text-blue-400 group-hover:text-white" /> GitHub Repo
                </button>
              </div>
            )}
          </div>

          {(isProjectsExpanded || !props.sidebarOpen) && (
            <div className="space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
              {activeProjects.map(project => {
                if (!project) return null;
                const isActive = safeConversations.find(c => c && c.id === props.activeConvId)?.projectId === project.id;
                
                return (
                  <div key={project.id} className="group relative">
                    <button 
                      onClick={() => {
                        const conv = safeConversations.find(c => c && c.projectId === project.id);
                        if (conv) props.onSelectConv(conv.id);
                        else props.onCreateConversation(project.id);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all border ${isActive ? 'bg-blue-600/10 text-blue-400 border-blue-500/20' : 'hover:bg-white/5 text-[var(--fg-muted)] border-transparent'} ${!props.sidebarOpen ? 'justify-center' : ''}`}
                    >
                      {project.repoUrl ? <GitBranch size={18} /> : <FolderPlus size={18} />}
                      {props.sidebarOpen && <span className="text-xs font-semibold truncate flex-1 text-left pr-10">{project.name}</span>}
                    </button>
                    
                    {props.sidebarOpen && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); props.onArchiveProject(project.id); }} className="p-1 hover:text-yellow-400"><Archive size={14} /></button>
                        <button onClick={(e) => { e.stopPropagation(); if(confirm('Silinsin?')) props.onDeleteProject(project.id); }} className="p-1 hover:text-red-400"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 space-y-2 border-t border-white/5">
        <button 
          onClick={props.onAuthClick}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-blue-600/10 text-blue-400 group ${!props.sidebarOpen ? 'justify-center' : ''}`}
        >
          <User size={20} className="group-hover:scale-110 transition-transform" />
          {props.sidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">Giriş / Qeydiyyat</span>}
        </button>

        <button 
          onClick={() => setShowSettings(!showSettings)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${showSettings ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-[var(--fg-muted)]'} ${!props.sidebarOpen ? 'justify-center' : ''}`}
        >
          <Settings size={20} />
          {props.sidebarOpen && <span className="text-xs font-medium">Settings</span>}
        </button>
      </div>

      {/* Add Project Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 backdrop-blur-md bg-black/60 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-[var(--bg-surface)] border border-white/10 rounded-3xl shadow-2xl p-8 relative">
            <button onClick={() => setShowAddModal(false)} className="absolute top-6 right-6 p-2 hover:bg-white/5 rounded-xl"><X size={20} /></button>
            <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
              {addMode === 'local' ? <FolderPlus className="text-blue-500" /> : <GitBranch className="text-blue-500" />}
              {addMode === 'local' ? 'Yeni Layihə' : 'GitHub-dan İdxal'}
            </h2>
            <div className="space-y-5">
              <input type="text" value={newProjName} onChange={e => setNewProjName(e.target.value)} placeholder="Layihə Adı" className="w-full bg-black/20 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50" />
              {addMode === 'remote' && <input type="text" value={newProjRepo} onChange={e => setNewProjRepo(e.target.value)} placeholder="GitHub URL" className="w-full bg-black/20 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50" />}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">İş Sahəsi (Qovluq)</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newProjPath} 
                    onChange={e => setNewProjPath(e.target.value)} 
                    placeholder="/Users/path/to/project" 
                    className="flex-1 bg-black/20 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50" 
                  />
                  <button 
                    onClick={handlePickDir} 
                    className="px-4 bg-blue-600/20 border border-blue-500/40 text-blue-400 rounded-xl hover:bg-blue-600/30 transition-all text-[10px] font-black whitespace-nowrap"
                  >
                    QOVLUQ SEÇ
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-8 flex justify-end gap-3">
              <button onClick={() => setShowAddModal(false)} className="px-6 py-3 text-xs font-bold hover:text-white transition-colors">LƏĞV ET</button>
              <button onClick={handleCreate} className="px-10 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg active:scale-95 transition-all">YARAT</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-xl bg-black/40 animate-in fade-in duration-300">
          <div className="w-full max-w-md bg-[var(--bg-surface)] border border-white/10 rounded-[2.5rem] shadow-[0_30px_100px_rgba(0,0,0,0.8)] p-10 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-6 flex gap-2">
              <ThemeToggle theme={props.themeCtx.theme} setTheme={props.themeCtx.setTheme} />
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/5 rounded-xl transition-colors"><X size={20} /></button>
            </div>
            
            <h2 className="text-xl font-black mb-8 flex items-center gap-3">
              <Settings className="text-blue-500" size={24} /> Settings
            </h2>

            <SettingsPanel 
              apiKey={props.apiKey} setApiKey={props.setApiKey}
              baseUrl={props.baseUrl} setBaseUrl={props.setBaseUrl}
              model={props.model} setModel={props.setModel}
              projectDir={props.projectDir} setProjectDir={props.setProjectDir}
              performanceMode={props.performanceMode} setPerformanceMode={props.setPerformanceMode}
            />

            <div className="mt-10 pt-6 border-t border-white/5 flex justify-end">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-10 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-widest rounded-2xl shadow-2xl shadow-blue-600/40 transition-all active:scale-95"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
