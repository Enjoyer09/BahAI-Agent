// ==========================================
// AdminPanel.tsx — Registered Users Management
// ==========================================

import { useState, useEffect } from 'react';
import { Shield, X, Search, User, Mail, Calendar, Key, Clock, MessageSquare, Activity } from 'lucide-react';
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

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

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
  return diff < 5 * 60 * 1000; // 5 dəqiqə ərzində aktiv
}

export default function AdminPanel({ isOpen, onClose }: AdminPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`${API_BASE_URL}/api/admin/users`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'İstifadəçilər yüklənə bilmədi');
        }

        const data = await res.json();
        setUsers(Array.isArray(data.users) ? data.users : []);
      } catch (err: any) {
        console.error('Error fetching admin users:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchUsers, 30000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredUsers = users.filter(u => 
    u.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const onlineCount = users.filter(u => isOnline(u.last_active)).length;
  const totalMessages = users.reduce((sum, u) => sum + (u.message_count || 0), 0);
  const totalConversations = users.reduce((sum, u) => sum + (u.conversation_count || 0), 0);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-xl bg-black/40 animate-in fade-in duration-300">
      <div className="w-full max-w-5xl bg-[var(--bg-surface)] border border-[var(--border)] rounded-[2.5rem] shadow-[0_30px_100px_rgba(0,0,0,0.8)] p-8 relative flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--border)] shrink-0">
          <h2 className="text-xl font-black flex items-center gap-3 text-[var(--fg-main)]">
            <Shield className="text-purple-500" size={24} /> Admin Dashboard
          </h2>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl text-[var(--fg-muted)] hover:text-[var(--fg-main)] transition-colors"
            title="Bağla"
          >
            <X size={20} />
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 shrink-0">
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

        {/* Search */}
        <div className="mb-4 shrink-0 relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-gray-500">
            <Search size={18} />
          </div>
          <input 
            type="text" 
            placeholder="İstifadəçi adı, email və ya rol axtar..." 
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
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center text-[var(--fg-muted)] gap-2">
              <p className="text-sm font-bold">Heç bir istifadəçi tapılmadı</p>
            </div>
          ) : (
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
                  {filteredUsers.map(u => {
                    const online = isOnline(u.last_active);
                    return (
                      <tr key={u.id} className="hover:bg-white/5 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="py-3.5 pl-4 font-bold text-[var(--fg-main)]">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div className="w-8 h-8 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full flex items-center justify-center">
                                <User size={14} />
                              </div>
                              {/* Online indicator */}
                              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--bg-surface)] ${
                                online ? 'bg-green-400' : 'bg-gray-500'
                              }`} />
                            </div>
                            <span className="truncate max-w-[120px]">{u.name || 'Adsız'}</span>
                          </div>
                        </td>
                        <td className="py-3.5 text-[var(--fg-muted)] text-xs">
                          {u.email}
                        </td>
                        <td className="py-3.5">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            u.role === 'admin' 
                              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30' 
                              : 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                          }`}>
                            <Key size={9} />
                            {u.role}
                          </span>
                        </td>
                        <td className="py-3.5">
                          <div className="flex items-center gap-1.5">
                            <Clock size={12} className={online ? 'text-green-400' : 'text-[var(--fg-muted)]'} />
                            <span className={`text-xs ${online ? 'text-green-400 font-semibold' : 'text-[var(--fg-muted)]'}`}>
                              {online ? 'Onlayn' : timeAgo(u.last_active)}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 text-center">
                          <span className="text-xs font-bold text-[var(--fg-main)]">{u.conversation_count || 0}</span>
                        </td>
                        <td className="py-3.5 text-center">
                          <span className="text-xs font-bold text-[var(--fg-main)]">{u.message_count || 0}</span>
                        </td>
                        <td className="py-3.5 text-[var(--fg-muted)] text-[11px]">
                          <span className="flex items-center gap-1.5">
                            <Calendar size={12} />
                            {new Date(u.created_at).toLocaleDateString('az-AZ', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-[var(--border)] flex items-center justify-between shrink-0">
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
