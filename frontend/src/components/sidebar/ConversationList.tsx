// ==========================================
// ConversationList — Multi-conversation sidebar
// ==========================================

import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import type { Conversation } from '../../lib/types';

interface ConversationListProps {
  conversations: Conversation[];
  activeConvId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'İndicə';
  if (mins < 60) return `${mins} dəq əvvəl`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saat əvvəl`;
  return `${Math.floor(hours / 24)} gün əvvəl`;
}

export default function ConversationList({ conversations, activeConvId, onSelect, onCreate, onDelete }: ConversationListProps) {
  return (
    <div className="flex flex-col h-full">
      <button
        onClick={onCreate}
        className="mx-3 mb-3 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed hover:border-blue-500/40 hover:bg-blue-500/5 transition-all text-sm group"
        style={{ borderColor: 'var(--border)', color: 'var(--fg-3)' }}
      >
        <Plus size={16} className="group-hover:text-blue-400 transition-colors" />
        <span>Yeni söhbət</span>
      </button>

      <div className="flex-1 overflow-y-auto space-y-0.5 px-2">
        {conversations.length === 0 && (
          <div className="text-center py-8 text-xs" style={{ color: 'var(--fg-faint)' }}>Hələ söhbət yoxdur</div>
        )}
        {conversations.map(conv => (
          <div
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
              activeConvId === conv.id ? 'bg-blue-500/10 border-blue-500/20' : 'border-transparent'
            }`}
            style={{ color: activeConvId === conv.id ? 'var(--fg)' : 'var(--fg-3)' }}
          >
            <MessageSquare size={14} className={`flex-shrink-0 ${activeConvId === conv.id ? 'text-blue-400' : ''}`} style={activeConvId !== conv.id ? { color: 'var(--fg-faint)' } : {}} />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{conv.title}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--fg-faint)' }}>{conv.messages.length} mesaj · {timeAgo(conv.updatedAt)}</div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); onDelete(conv.id); }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-red-400 transition-all"
              style={{ color: 'var(--fg-faint)' }} title="Sil"
            ><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
