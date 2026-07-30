/**
 * bahAI - Sidebar Conversation List Flow
 * Adapted from LibreChat's Nav/Sidebar components.
 * Groups conversations by time (Today, Previous 7 Days, etc.)
 * Styling is completely tailored to bahAI's visual language.
 */

import { useMemo } from 'react';
import { MessageSquare, Trash2, Edit2 } from 'lucide-react';

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

interface ConversationListProps {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
}

export function ConversationList({ conversations, activeId, onSelect, onDelete }: ConversationListProps) {
  // LibreChat inspired grouping logic
  const groupedConversations = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const groups: Record<string, Conversation[]> = {
      'Today': [],
      'Yesterday': [],
      'Previous 7 Days': [],
      'Older': []
    };

    conversations.forEach(conv => {
      const date = new Date(conv.updatedAt);
      if (date >= today) {
        groups['Today'].push(conv);
      } else if (date >= yesterday) {
        groups['Yesterday'].push(conv);
      } else if (date >= lastWeek) {
        groups['Previous 7 Days'].push(conv);
      } else {
        groups['Older'].push(conv);
      }
    });

    return groups;
  }, [conversations]);

  return (
    <div className="flex flex-col gap-4 p-2 text-sm text-gray-300">
      {Object.entries(groupedConversations).map(([groupName, convs]) => {
        if (convs.length === 0) return null;
        
        return (
          <div key={groupName} className="flex flex-col gap-1">
            <h3 className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {groupName}
            </h3>
            {convs.map(conv => (
              <div 
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`group flex items-center justify-between px-2 py-2 rounded-md cursor-pointer transition-colors ${
                  activeId === conv.id ? 'bg-indigo-600 text-white' : 'hover:bg-gray-800'
                }`}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <MessageSquare size={16} className="shrink-0" />
                  <span className="truncate">{conv.title || 'Yeni Söhbət'}</span>
                </div>
                
                {/* Actions visible on hover (bahAI tailored UX) */}
                <div className="hidden group-hover:flex items-center gap-1">
                  <button 
                    onClick={(e) => { e.stopPropagation(); /* trigger rename */ }}
                    className="p-1 hover:text-indigo-300 transition-colors"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                    className="p-1 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
