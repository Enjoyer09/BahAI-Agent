/**
 * bahAI - Message Rendering Architecture
 * Adapted from LibreChat's Message components.
 * Renders user/assistant messages with markdown, attachments, and action buttons.
 */
import MarkdownRenderer from '../common/MarkdownRenderer';

import { User, Bot, Edit2, RotateCcw } from 'lucide-react';

interface Attachment {
  name: string;
  url?: string;
  type?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  attachments?: Attachment[];
}

interface MessageBubbleProps {
  message: Message;
  onEdit?: (id: string, newContent: string) => void;
  onRegenerate?: (id: string) => void;
  settings?: any;
}

export function MessageBubble({ message, onEdit, onRegenerate, settings }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full py-4 px-2 lg:px-0 group ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex gap-4 max-w-4xl w-full ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        
        {/* Avatar */}
        <div className={`shrink-0 flex items-center justify-center h-8 w-8 rounded-full ${isUser ? 'bg-indigo-600' : 'bg-green-600'}`}>
          {isUser ? <User size={18} className="text-white" /> : <Bot size={18} className="text-white" />}
        </div>

        {/* Content Area */}
        <div className={`flex flex-col gap-2 min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
          
          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {message.attachments.map((att, idx) => (
                <div key={idx} className="bg-gray-800 rounded p-1 border border-gray-700 max-w-[150px]">
                  {att.type?.startsWith('image') && att.url ? (
                    <img src={att.url} alt={att.name} className="w-full h-auto rounded" />
                  ) : (
                    <div className="text-xs text-gray-300 truncate p-2">{att.name}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Text Bubble */}
          <div 
            className="p-3 rounded-lg max-w-full overflow-hidden"
            style={{
              backgroundColor: isUser ? 'var(--bg-elevated)' : 'var(--bg-surface-alt)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--fg-main)',
              fontSize: settings?.messageFontSize === 'small' ? '13px' : settings?.messageFontSize === 'large' ? '17px' : '15px'
            }}
          >
            {isUser && settings?.enableMarkdown !== true ? (
              <div className="whitespace-pre-wrap break-words leading-7">
                {message.content}
              </div>
            ) : (
              <div className="leading-7">
                <MarkdownRenderer 
                  content={settings?.showThinking === false ? message.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : message.content} 
                />
              </div>
            )}
          </div>

          {/* Action Buttons (Hover) */}
          <div className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
            {isUser && onEdit && (
              <button onClick={() => onEdit(message.id, message.content)} className="text-gray-500 hover:text-gray-300">
                <Edit2 size={14} />
              </button>
            )}
            {!isUser && onRegenerate && (
              <button onClick={() => onRegenerate(message.id)} className="text-gray-500 hover:text-gray-300">
                <RotateCcw size={14} />
              </button>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}
