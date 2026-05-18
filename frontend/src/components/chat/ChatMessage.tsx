import { User, Copy, Check, FileText, ChevronDown, ChevronRight, Loader2, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import { useState, useCallback } from 'react';
import MarkdownRenderer from '../common/MarkdownRenderer';
import ToolCallCard from './ToolCallCard';
import type { Message } from '../../lib/types';

interface Props {
  message: Message;
  pendingApprovals?: { approvalId: string; tool: string; args: string }[];
  onApprove?: (id: string, decision: 'approve' | 'reject') => void;
}

export default function ChatMessage({ message, pendingApprovals, onApprove }: Props) {
  const [copied, setCopied] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const isBot = message.role === 'assistant';
  const isUser = message.role === 'user';

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  // Tool messages are rendered inside ToolCallCard
  if (message.role === 'tool') return null;

  const hasRunningTools = message.tool_calls?.some(tc => tc.status === 'running');
  const hasTools = message.tool_calls && message.tool_calls.length > 0;

  return (
    <div className="group animate-in" style={{ animationDelay: '50ms' }}>
      <div className="flex items-start gap-3">
        {/* AVATAR */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: isBot ? 'var(--color-accent-muted)' : 'var(--bg-hover)',
            border: '1px solid var(--border)',
          }}
        >
          {isBot ? (
            hasRunningTools ? (
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            ) : (
              <span className="text-xs font-bold" style={{ color: 'var(--color-accent)' }}>AI</span>
            )
          ) : (
            <User size={14} style={{ color: 'var(--fg-muted)' }} />
          )}
        </div>

        {/* CONTENT */}
        <div className="flex-1 min-w-0">
          {/* Role label */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold" style={{ color: 'var(--fg-secondary)' }}>
              {isBot ? 'bahAI' : 'You'}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Running indicator */}
          {isBot && hasRunningTools && (
            <div
              className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg w-fit text-xs"
              style={{
                background: 'var(--color-accent-muted)',
                border: '1px solid var(--border)',
                color: 'var(--color-accent)',
              }}
            >
              <Loader2 size={12} className="animate-spin" />
              <span className="font-medium">Executing...</span>
            </div>
          )}

          {/* Message bubble */}
          <div
            className="rounded-xl px-4 py-3 leading-relaxed break-words relative"
            style={{
              background: isUser ? 'var(--bubble-user)' : 'var(--bubble-bot)',
              color: isUser ? 'var(--fg-on-accent)' : 'var(--fg-main)',
              border: isUser ? 'none' : '1px solid var(--border)',
            }}
          >
            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {message.attachments.map((at, i) => (
                  <div
                    key={i}
                    className="rounded-lg overflow-hidden"
                    style={{ border: '1px solid var(--border)', background: 'var(--bg-hover)' }}
                  >
                    {at.type === 'image' ? (
                      <img src={at.url} alt="attachment" className="max-w-[200px] h-auto" />
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <FileText size={14} style={{ color: 'var(--fg-muted)' }} />
                        <span className="text-xs truncate max-w-[120px]" style={{ color: 'var(--fg-secondary)' }}>
                          {at.name}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Content */}
            <div className="prose prose-sm max-w-none" style={{ color: 'inherit' }}>
              <MarkdownRenderer content={message.content || ''} />
            </div>

            {/* Copy button */}
            <button
              onClick={copyToClipboard}
              className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'var(--bg-hover)', color: 'var(--fg-muted)' }}
              aria-label="Copy message"
            >
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            </button>
          </div>

          {/* Tool calls */}
          {isBot && hasTools && (
            <div className="mt-2">
              <button
                onClick={() => setShowTools(!showTools)}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors"
                style={{ color: 'var(--fg-muted)', background: showTools ? 'var(--bg-hover)' : 'transparent' }}
              >
                {showTools ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {message.tool_calls!.length} tool call{message.tool_calls!.length > 1 ? 's' : ''}
              </button>

              {showTools && (
                <div className="mt-2 space-y-2 animate-in">
                  {message.tool_calls!.map((tc, j) => (
                    <ToolCallCard
                      key={j}
                      toolName={tc.function?.name || tc.name}
                      args={tc.function?.arguments || tc.args}
                      result={tc.result}
                      status={tc.status}
                      duration={tc.duration}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pending approvals */}
          {isBot && pendingApprovals && pendingApprovals.length > 0 && (
            <div className="mt-3 space-y-2">
              {pendingApprovals.map((approval) => (
                <div
                  key={approval.approvalId}
                  className="rounded-xl p-4 animate-in"
                  style={{
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.2)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold" style={{ color: '#fbbf24' }}>
                      Approval Required
                    </span>
                  </div>
                  <div className="text-xs mb-3" style={{ color: 'var(--fg-secondary)' }}>
                    <span className="font-mono" style={{ color: 'var(--fg-main)' }}>{approval.tool}</span>
                  </div>
                  <pre
                    className="text-xs p-2 rounded-lg mb-3 overflow-auto max-h-32"
                    style={{ background: 'var(--bg-hover)', color: 'var(--fg-muted)' }}
                  >
                    {(() => {
                      try { return JSON.stringify(JSON.parse(approval.args), null, 2); }
                      catch { return approval.args; }
                    })()}
                  </pre>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onApprove?.(approval.approvalId, 'reject')}
                      className="px-3 py-1.5 text-xs rounded-lg transition-colors"
                      style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => onApprove?.(approval.approvalId, 'approve')}
                      className="px-3 py-1.5 text-xs rounded-lg transition-colors"
                      style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.2)' }}
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Message actions */}
          {isBot && !hasRunningTools && (
            <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="p-1 rounded-md transition-colors"
                style={{ color: 'var(--fg-muted)' }}
                aria-label="Good response"
              >
                <ThumbsUp size={12} />
              </button>
              <button
                className="p-1 rounded-md transition-colors"
                style={{ color: 'var(--fg-muted)' }}
                aria-label="Bad response"
              >
                <ThumbsDown size={12} />
              </button>
              <button
                className="p-1 rounded-md transition-colors"
                style={{ color: 'var(--fg-muted)' }}
                aria-label="Regenerate"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
