import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, Send, Square, X } from 'lucide-react';
import type { Attachment } from '../../lib/types';
import { useToast } from '../common/Toast';

interface ComposerProps {
  onSendMessage: (text: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  isGenerating?: boolean;
  onStop?: () => void;
  settings?: any;
}

const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_FILE = /\.(png|jpe?g|gif|webp|pdf|docx?|xlsx?|csv|txt|md|json|ya?ml|xml|log)$/i;

function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      id: globalThis.crypto?.randomUUID?.() || `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      type: file.type.startsWith('image/') ? 'image' : 'file',
      mimeType: file.type || 'application/octet-stream',
      url: String(reader.result || ''),
    });
    reader.onerror = () => reject(new Error(`${file.name}: faylı oxumaq alınmadı.`));
    reader.readAsDataURL(file);
  });
}

export function Composer({ onSendMessage, disabled, isGenerating, onStop, settings }: ComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toastCtx = useToast();
  const toast = toastCtx?.toast;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [text]);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const available = MAX_ATTACHMENTS - attachments.length;
    if (available <= 0) {
      toast?.('Bir mesajda maksimum 5 fayl əlavə etmək olar.', 'info', 4000);
      return;
    }

    const accepted: File[] = [];
    for (const file of Array.from(files).slice(0, available)) {
      if (file.size > MAX_FILE_SIZE) {
        toast?.(`${file.name}: maksimum ölçü 10 MB-dır.`, 'error', 5000);
      } else if (!file.type.startsWith('image/') && !ALLOWED_FILE.test(file.name)) {
        toast?.(`${file.name}: bu fayl növü dəstəklənmir.`, 'error', 5000);
      } else {
        accepted.push(file);
      }
    }

    const results = await Promise.allSettled(accepted.map(fileToAttachment));
    const next = results
      .filter((result): result is PromiseFulfilledResult<Attachment> => result.status === 'fulfilled')
      .map((result) => result.value);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) toast?.(String(failed.reason?.message || 'Fayl oxunmadı.'), 'error', 5000);
    if (next.length > 0) setAttachments((previous) => [...previous, ...next].slice(0, MAX_ATTACHMENTS));
  }, [attachments.length, toast]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((previous) => previous.filter((attachment) => attachment.id !== id));
  }, []);

  const handleSubmit = useCallback(() => {
    if ((!text.trim() && attachments.length === 0) || disabled) return;
    onSendMessage(text.trim(), attachments);
    setText('');
    setAttachments([]);
  }, [attachments, disabled, onSendMessage, text]);

  return (
    <div
      className="composer-frame"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void addFiles(event.dataTransfer.files);
      }}
    >
      {attachments.length > 0 && (
        <div className="composer-attachment-tray no-scrollbar" aria-label="Selected attachments">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="composer-attachment">
              {attachment.type === 'image' ? (
                <img src={attachment.url} alt={attachment.name} />
              ) : (
                <div className="composer-file-preview">
                  <FileText size={18} />
                  <span>{attachment.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                aria-label={`${attachment.name} faylını sil`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer-input-row">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
          className="composer-icon-button"
          title="Şəkil və ya fayl əlavə et"
          aria-label="Attach file"
        >
          <Paperclip size={20} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.yaml,.yml,.xml,.log"
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = '';
          }}
          aria-label="Choose attachment"
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
            if (imageFiles.length > 0) {
              event.preventDefault();
              void addFiles(imageFiles);
            }
          }}
          onKeyDown={(event) => {
            const enterToSend = settings?.enterToSend !== false;
            if (event.key !== 'Enter') return;
            if ((enterToSend && !event.shiftKey) || (!enterToSend && (event.ctrlKey || event.metaKey))) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Mesajınızı yazın..."
          className="composer-textarea"
          rows={1}
          disabled={disabled}
          aria-label="Message input"
        />

        {isGenerating ? (
          <button type="button" onClick={onStop} className="composer-send-button is-stop" aria-label="Stop generation">
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={disabled || (!text.trim() && attachments.length === 0)}
            className="composer-send-button"
            aria-label="Send message"
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
