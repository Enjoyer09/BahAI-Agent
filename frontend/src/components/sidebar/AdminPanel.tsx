// ==========================================
// AdminPanel.tsx — Full Admin Dashboard with Tabs
// ==========================================

import { useState, useEffect } from 'react';
import { Shield, X, Search, User, Mail, Calendar, Key, Clock, MessageSquare, Activity, LogIn, Timer, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { API_BASE_URL } from '../../lib/constants';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
  created_at: string;
  last_active: string | null;
  conversation_count: number;
  message_count: number;
}

interface LoginRecord {
  id: number;
  email: string;
  user_name: string | null;
  success: boolean;
  ip_address: string;
  user_agent: string;
  method: string;
  created_at: string;
}

interface SessionRecord {
  id: number;
  user_id: number;
  user_name: string | null;
  email: string;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  duration_minutes: number;
  ip_address: string;
}

interface ErrorRecord {
  id: number;
  user_id: number | null;
  email: string | null;
  user_name: string | null;
  error_type: string;
  error_message: string;
  endpoint: string;
  metadata: any;
  created_at: string;
}

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'users' | 'logins' | 'sessions' | 'errors';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Heç vaxt';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'İndicə';
  if (mins < 60) return `${mins} dəq əvvəl`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saat əvvəl`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} gün əvvəl`;
  return `${Math.floor(days / 30)} ay əvvəl`;
}

function isOnline(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff < 5 * 60 * 1000;
}

function formatDuration(minutes: number | null): string {
  if (!minutes || minutes < 1) return '< 1 dəq';
  if (minutes < 60) return `${Math.round(minutes)} dəq`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} saat ${m} dəq`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('az-AZ', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

async function fetchAdmin(endpoint: string) {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${API_BASE_URL}/api/admin/${endpoint}`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Yüklənə bilmədi');
  }
  return res.json();
}

export default function AdminPanel({ isOpen, onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logins, setLogins] = useState<LoginRecord[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [errors, setErrors] = useState<ErrorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [isOpen, activeTab]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'users') {
        const data = await fetchAdmin('users');
        setUsers(Array.isArray(data.users) ? data.users : []);
      } else if (activeTab === 'logins') {
        const data = await fetchAdmin('login-history');
        setLogins(Array.isArray(data.logins) ? data.logins : []);
      } else if (activeTab === 'sessions') {
        const data = await fetchAdmin('sessions');
        setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      } else if (activeTab === 'errors') {
        const data = await fetchAdmin('errors');
        setErrors(Array.isArray(data.errors) ? data.errors : []);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  const onlineCount = users.filter(u => isOnline(u.last_active)).length;
  const totalMessages = users.reduce((sum, u) => sum + (u.message_count || 0), 0);
  const totalConversations = users.reduce((sum, u) => sum + (u.conversation_count || 0), 0);

  const tabs: { id: TabId; label: string; icon: any; count?: number }[] = [
    { id: 'users', label: 'İstifadəçilər', icon: User, count: users.length },
    { id: 'logins', label: 'Login Tarixi', icon: LogIn, count: logins.length },
    { id: 'sessions', label: 'Sessiyalar', icon: Timer, count: sessions.length },
    { id: 'errors', label: 'Xətalar', icon: AlertTriangle, count: errors.length },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-xl bg-black/40 animate-in fade-in duration-300">
      <div className="w-full max-w-6xl bg-[var(--bg-surface)] border border-[var(--border)] rounded-[2.5rem] shadow-[0_30px_100px_rgba(0,0,0,0.8)] p-8 relative flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-[var(--border)] shrink-0">
          <h2 className="text-xl font-black flex items-center gap-3 text-[var(--fg-main)]">
            <Shield className="text-purple-500" size={24} /> Admin Dashboard
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl text-[var(--fg-muted)] hover:text-[var(--fg-main)] transition-colors" title="Bağla">
            <X size={20} />
          </button>
        </div>

        {/* Stats Cards - only show on users tab */}
        {activeTab === 'users' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 shrink-0">
            <div className="rounded-2xl p-4 border border-[var(--border)]" style={{ background: 'var(--bg-hover)' }}>
              <div className="flex items-center gap-2 mb-1">
                <User size={14} className="text-purple-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--fg-muted)]">İstifadəçilər</span>
              </div>
              <span className="text-2xl font-black text-[var(--fg-main)]">{users.length}</span>
            </div>
            <div className="rounded-2xl p-4 border border-[var(--border)]" style={{ background: 'var(--bg-hover)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Activity size={14} className="text-green-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--fg-muted)]">Onlayn</span>
              </div>
              <span className="text-2xl font-black text-green-400">{onlineCount}</span>
            </div>
            <div className="rounded-2xl p-4 border border-[var(--border)]" style={{ background: 'var(--bg-hover)' }}>
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare size={14} className="text-blue-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--fg-muted)]">Söhbətlər</span>
              </div>
              <span className="text-2xl font-black text-[var(--fg-main)]">{totalConversations}</span>
            </div>
            <div className="rounded-2xl p-4 border border-[var(--border)]" style={{ background: 'var(--bg-hover)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Mail size={14} className="text-orange-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--fg-muted)]">Mesajlar</span>
              </div>
              <span className="text-2xl font-black text-[var(--fg-main)]">{totalMessages}</span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 shrink-0 bg-black/10 dark:bg-white/5 rounded-2xl p-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === tab.id
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                  : 'text-[var(--fg-muted)] hover:text-[var(--fg-main)] hover:bg-white/5'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="mb-4 shrink-0 relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-gray-500">
            <Search size={18} />
          </div>
          <input 
            type="text" 
            placeholder="Axtar..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-black/20 border border-[var(--border)] rounded-2xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-purple-500/50 text-[var(--fg-main)] transition-all"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto premium-scroll pr-1 min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs font-bold uppercase tracking-widest text-purple-400">Yüklənir...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <div className="p-4 bg-red-600/10 text-red-500 rounded-full border border-red-500/20">
                <X size={24} />
              </div>
              <p className="text-sm font-semibold text-red-400">{error}</p>
            </div>
          ) : (
            <>
              {activeTab === 'users' && <UsersTab users={users} searchTerm={searchTerm} />}
              {activeTab === 'logins' && <LoginsTab logins={logins} searchTerm={searchTerm} />}
              {activeTab === 'sessions' && <SessionsTab sessions={sessions} searchTerm={searchTerm} />}
              {activeTab === 'errors' && <ErrorsTab errors={errors} searchTerm={searchTerm} />}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-[var(--border)] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[var(--fg-muted)]">
            Hər 30 saniyədə avtomatik yenilənir
          </span>
          <button 
            onClick={onClose}
            className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white text-xs font-black uppercase tracking-widest rounded-2xl shadow-2xl shadow-purple-600/40 transition-all active:scale-95"
          >
            Bağla
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Tab Components
// ==========================================

function UsersTab({ users, searchTerm }: { users: AdminUser[]; searchTerm: string }) {
  const filtered = users.filter(u => 
    u.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (filtered.length === 0) return <EmptyState text="Heç bir istifadəçi tapılmadı" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--border)] text-[10px] font-black uppercase tracking-widest text-[var(--fg-muted)]">
            <th className="pb-3 pl-4">İstifadəçi</th>
            <th className="pb-3">Email</th>
            <th className="pb-3">Rol</th>
            <th className="pb-3">Son Aktivlik</th>
            <th className="pb-3">Söhbət</th>
            <th className="pb-3">Mesaj</th>
            <th className="pb-3">Qeydiyyat</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]/30 text-sm">
          {filtered.map(u => {
            const online = isOnline(u.last_active);
            return (
              <tr key={u.id} className="hover:bg-white/5 transition-colors">
                <td className="py-3.5 pl-4 font-bold text-[var(--fg-main)]">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-8 h-8 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full flex items-center justify-center">
                        <User size={14} />
                      </div>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--bg-surface)] ${online ? 'bg-green-400' : 'bg-gray-500'}`} />
                    </div>
                    <span className="truncate max-w-[120px]">{u.name || 'Adsız'}</span>
                  </div>
                </td>
                <td className="py-3.5 text-[var(--fg-muted)] text-xs">{u.email}</td>
                <td className="py-3.5">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    u.role === 'admin' ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30' : 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  }`}><Key size={9} />{u.role}</span>
                </td>

                <td className="py-3.5">
                  <div className="flex items-center gap-1.5">
                    <Clock size={12} className={online ? 'text-green-400' : 'text-[var(--fg-muted)]'} />
                    <span className={`text-xs ${online ? 'text-green-400 font-semibold' : 'text-[var(--fg-muted)]'}`}>
                      {online ? 'Onlayn' : timeAgo(u.last_active)}
                    </span>
                  </div>
                </td>
                <td className="py-3.5 text-center"><span className="text-xs font-bold text-[var(--fg-main)]">{u.conversation_count || 0}</span></td>
                <td className="py-3.5 text-center"><span className="text-xs font-bold text-[var(--fg-main)]">{u.message_count || 0}</span></td>
                <td className="py-3.5 text-[var(--fg-muted)] text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <Calendar size={12} />
                    {new Date(u.created_at).toLocaleDateString('az-AZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LoginsTab({ logins, searchTerm }: { logins: LoginRecord[]; searchTerm: string }) {
  const filtered = logins.filter(l =>
    l.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.method?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.ip_address?.includes(searchTerm)
  );

  if (filtered.length === 0) return <EmptyState text="Login tarixi boşdur" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--border)] text-[10px] font-black uppercase tracking-widest text-[var(--fg-muted)]">
            <th className="pb-3 pl-4">Status</th>
            <th className="pb-3">İstifadəçi</th>
            <th className="pb-3">Email</th>
            <th className="pb-3">Metod</th>
            <th className="pb-3">IP</th>
            <th className="pb-3">Tarix</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]/30 text-sm">
          {filtered.map(l => (
            <tr key={l.id} className="hover:bg-white/5 transition-colors">
              <td className="py-3 pl-4">
                {l.success ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-600/20 text-green-400 border border-green-500/30">
                    <CheckCircle size={10} /> Uğurlu
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-600/20 text-red-400 border border-red-500/30">
                    <XCircle size={10} /> Uğursuz
                  </span>
                )}
              </td>
              <td className="py-3 text-xs font-semibold text-[var(--fg-main)]">{l.user_name || '—'}</td>
              <td className="py-3 text-xs text-[var(--fg-muted)]">{l.email}</td>
              <td className="py-3">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-600/10 text-blue-400 border border-blue-500/20">
                  {l.method}
                </span>
              </td>
              <td className="py-3 text-[11px] text-[var(--fg-muted)] font-mono">{l.ip_address}</td>
              <td className="py-3 text-[11px] text-[var(--fg-muted)]">{formatDate(l.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionsTab({ sessions, searchTerm }: { sessions: SessionRecord[]; searchTerm: string }) {
  const filtered = sessions.filter(s =>
    s.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.ip_address?.includes(searchTerm)
  );

  if (filtered.length === 0) return <EmptyState text="Sessiya məlumatı yoxdur" />;

  const totalMinutes = filtered.reduce((sum, s) => sum + (Number(s.duration_minutes) || 0), 0);

  return (
    <div>
      <div className="mb-4 flex gap-3">
        <div className="rounded-2xl p-3 border border-[var(--border)] bg-[var(--bg-hover)]">
          <span className="text-[10px] font-bold uppercase text-[var(--fg-muted)]">Ümumi sessiya</span>
          <p className="text-lg font-black text-[var(--fg-main)]">{filtered.length}</p>
        </div>
        <div className="rounded-2xl p-3 border border-[var(--border)] bg-[var(--bg-hover)]">
          <span className="text-[10px] font-bold uppercase text-[var(--fg-muted)]">Ümumi vaxt</span>
          <p className="text-lg font-black text-[var(--fg-main)]">{formatDuration(totalMinutes)}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] font-black uppercase tracking-widest text-[var(--fg-muted)]">
              <th className="pb-3 pl-4">İstifadəçi</th>
              <th className="pb-3">Email</th>
              <th className="pb-3">Başladı</th>
              <th className="pb-3">Son görülmə</th>
              <th className="pb-3">Müddət</th>
              <th className="pb-3">Status</th>
              <th className="pb-3">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]/30 text-sm">
            {filtered.map(s => {
              const isActive = !s.ended_at && (Date.now() - new Date(s.last_seen_at).getTime() < 5 * 60 * 1000);
              return (
                <tr key={s.id} className="hover:bg-white/5 transition-colors">
                  <td className="py-3 pl-4 text-xs font-semibold text-[var(--fg-main)]">{s.user_name || '—'}</td>
                  <td className="py-3 text-xs text-[var(--fg-muted)]">{s.email}</td>
                  <td className="py-3 text-[11px] text-[var(--fg-muted)]">{formatDate(s.started_at)}</td>
                  <td className="py-3 text-[11px] text-[var(--fg-muted)]">{timeAgo(s.last_seen_at)}</td>
                  <td className="py-3 text-xs font-bold text-[var(--fg-main)]">{formatDuration(Number(s.duration_minutes))}</td>
                  <td className="py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      isActive ? 'bg-green-600/20 text-green-400 border border-green-500/30' : 'bg-gray-600/20 text-gray-400 border border-gray-500/30'
                    }`}>
                      {isActive ? '● Aktiv' : '○ Bitib'}
                    </span>
                  </td>
                  <td className="py-3 text-[11px] text-[var(--fg-muted)] font-mono">{s.ip_address}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ErrorsTab({ errors, searchTerm }: { errors: ErrorRecord[]; searchTerm: string }) {
  const filtered = errors.filter(e =>
    e.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.error_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.error_message?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.endpoint?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (filtered.length === 0) return <EmptyState text="Xəta qeyd olunmayıb 🎉" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--border)] text-[10px] font-black uppercase tracking-widest text-[var(--fg-muted)]">
            <th className="pb-3 pl-4">Tip</th>
            <th className="pb-3">İstifadəçi</th>
            <th className="pb-3">Mesaj</th>
            <th className="pb-3">Endpoint</th>
            <th className="pb-3">Tarix</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]/30 text-sm">
          {filtered.map(e => (
            <tr key={e.id} className="hover:bg-white/5 transition-colors">
              <td className="py-3 pl-4">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-600/10 text-red-400 border border-red-500/20">
                  {e.error_type}
                </span>
              </td>
              <td className="py-3 text-xs text-[var(--fg-muted)]">{e.user_name || e.email || '—'}</td>
              <td className="py-3 text-xs text-red-400 max-w-[200px] truncate" title={e.error_message}>
                {e.error_message}
              </td>
              <td className="py-3 text-[11px] text-[var(--fg-muted)] font-mono">{e.endpoint || '—'}</td>
              <td className="py-3 text-[11px] text-[var(--fg-muted)]">{formatDate(e.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center text-[var(--fg-muted)] gap-2">
      <p className="text-sm font-bold">{text}</p>
    </div>
  );
}
