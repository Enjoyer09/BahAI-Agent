// ==========================================
// Follow-Up Suggestions — Open WebUI-inspired
// ==========================================
// Shows 2-3 suggested follow-up questions after the assistant's
// response. Suggestions are generated client-side from the last
// assistant message using simple heuristics (no extra LLM call).

import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { Message } from '../../lib/types';

interface Props {
  messages: Message[];
  loading: boolean;
  onSend: (msg: string) => void;
  productMode?: 'web_chat' | 'desktop_code';
}

// Simple heuristic-based suggestion generator.
// Analyzes the last assistant message and user message to produce
// contextually relevant follow-up prompts without an extra API call.
function generateSuggestions(messages: Message[], productMode?: string): string[] {
  if (messages.length < 2) return [];

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastAssistant?.content || !lastUser?.content) return [];

  const assistantText = lastAssistant.content.toLowerCase();
  const userText = lastUser.content.toLowerCase();
  const suggestions: string[] = [];

  // Code-related
  if (/```|function|class|const |let |import /.test(assistantText)) {
    suggestions.push('Bu kodu daha optimallaşdıra bilərsən?');
    if (/error|bug|xəta|problem/.test(userText)) {
      suggestions.push('Başqa oxşar problem ola bilərmi?');
    } else {
      suggestions.push('Buna test yaza bilərsən?');
    }
  }

  // Explanation / educational
  if (/nədir|nedir|izah|explanation|means|deməkdir/.test(userText)) {
    suggestions.push('Real həyatdan bir misal göstərə bilərsən?');
    suggestions.push('Bu mövzunu daha dərindən izah et');
  }

  // List / comparison
  if (/(\d+[\.\)]\s)|•|fərq|müqayisə|compare|difference/.test(assistantText)) {
    suggestions.push('Hansını tövsiyə edirsən və niyə?');
    suggestions.push('Daha detallı müqayisə edə bilərsən?');
  }

  // Plan / steps
  if (/plan|addım|step|mərhələ|strategiya/.test(assistantText) || /plan|strategiya/.test(userText)) {
    suggestions.push('Bu planın riskləri nələrdir?');
    suggestions.push('İlk addımdan başla və detallı izah et');
  }

  // Weather / info
  if (/°c|temperatur|hava|humidity|rütubət/.test(assistantText)) {
    suggestions.push('Sabah havanın necə olacağını da deyə bilərsən?');
    suggestions.push('Bu hava şəraiti üçün nə geyinməliyəm?');
  }

  // Writing / text improvement
  if (/yaz|write|mətn|text|məktub|letter|email/.test(userText)) {
    suggestions.push('Daha qısa versiyasını yaza bilərsən?');
    suggestions.push('Tonunu daha rəsmi/qeyri-rəsmi et');
  }

  // General fallbacks when no specific pattern matched
  if (suggestions.length === 0) {
    if (assistantText.length > 200) {
      suggestions.push('Bunu daha qısa xülasə edə bilərsən?');
    }
    suggestions.push('Bu barədə daha çox məlumat ver');
    if (productMode === 'web_chat') {
      suggestions.push('Başqa bir sualım var...');
    }
  }

  // Deduplicate and limit to 3
  return [...new Set(suggestions)].slice(0, 3);
}

export default function FollowUpSuggestions({ messages, loading, onSend, productMode }: Props) {
  const suggestions = useMemo(
    () => (loading ? [] : generateSuggestions(messages, productMode)),
    [messages, loading, productMode]
  );

  if (suggestions.length === 0 || loading) return null;

  // Only show for web_chat
  if (productMode !== 'web_chat') return null;

  // Don't show if the last message is from the user (they're about to get a response)
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== 'assistant') return null;

  // Don't show if the last message is an error
  if (lastMsg.content.includes('❌ Xəta')) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-3 mb-1 animate-in fade-in duration-300">
      <Sparkles size={14} className="mt-1.5 shrink-0" style={{ color: 'var(--color-accent)', opacity: 0.7 }} />
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          onClick={() => onSend(suggestion)}
          className="px-3 py-1.5 text-xs rounded-full transition-all hover:scale-[1.02] active:scale-95"
          style={{
            border: '1px solid var(--border)',
            color: 'var(--fg-secondary)',
            background: 'var(--bg-surface-elevated, rgba(255,255,255,0.03))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-accent)';
            e.currentTarget.style.color = 'var(--fg-main)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.color = 'var(--fg-secondary)';
          }}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
