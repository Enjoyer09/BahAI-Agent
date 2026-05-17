// ==========================================
// AdminPanel.tsx — Registered Users Management
// ==========================================

import { useState, useEffect } from 'react';
import { Shield, X, Search, User, Mail, Calendar, Key } from 'lucide-react';
import { API_BASE_URL } from '../../lib/constants';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
  created_at: string;
}

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
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
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredUsers = users.filter(u => 
    u.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-xl bg-black/40 animate-in fade-in duration-300">
      <div className="w-full max-w-4xl bg-[var(--bg-surface)] border border-[var(--border)] rounded-[2.5rem] shadow-[0_30px_100px_rgba(0,0,0,0.8)] p-10 relative flex flex-col max-h-[90vh]">
        
        {/* Header Section */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-[var(--border)] shrink-0">
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

        {/* Real-time Search Input */}
        <div className="mb-6 shrink-0 relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-gray-500">
            <Search size={18} />
          </div>
          <input 
            type="text" 
            placeholder="İstifadəçi adı, email və ya rol axtar..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-black/20 border border-[var(--border)] rounded-2xl pl-12 pr-4 py-3.5 text-sm focus:outline-none focus:border-purple-500/50 text-[var(--fg-main)] transition-all"
          />
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto premium-scroll pr-1 min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs font-bold uppercase tracking-widest text-purple-400">İstifadəçilər Yüklənir...</span>
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
              <p className="text-xs">Axtarış filtrlərini dəyişməyi yoxlayın.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] font-black uppercase tracking-widest text-[var(--fg-muted)]">
                    <th className="pb-4 pl-4">İstifadəçi</th>
                    <th className="pb-4">Email</th>
                    <th className="pb-4">Rol</th>
                    <th className="pb-4">Qeydiyyat Tarixi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/30 text-sm">
                  {filteredUsers.map(u => (
                    <tr key={u.id} className="hover:bg-white/5 dark:hover:bg-white/[0.02] transition-colors group">
                      <td className="py-4 pl-4 font-bold text-[var(--fg-main)] flex items-center gap-3">
                        <div className="w-8 h-8 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full flex items-center justify-center">
                          <User size={16} />
                        </div>
                        {u.name || 'Ad daxil edilməyib'}
                      </td>
                      <td className="py-4 text-[var(--fg-muted)] font-medium">
                        <span className="flex items-center gap-2">
                          <Mail size={14} />
                          {u.email}
                        </span>
                      </td>
                      <td className="py-4">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          u.role === 'admin' 
                            ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30' 
                            : 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                        }`}>
                          <Key size={10} />
                          {u.role}
                        </span>
                      </td>
                      <td className="py-4 text-[var(--fg-muted)] text-xs">
                        <span className="flex items-center gap-2">
                          <Calendar size={14} />
                          {new Date(u.created_at).toLocaleDateString('az-AZ', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer Done Action */}
        <div className="mt-8 pt-6 border-t border-[var(--border)] flex justify-end shrink-0">
          <button 
            onClick={onClose}
            className="w-full sm:w-auto px-10 py-3.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-black uppercase tracking-widest rounded-2xl shadow-2xl shadow-purple-600/40 transition-all active:scale-95"
          >
            Bağla
          </button>
        </div>
      </div>
    </div>
  );
}
