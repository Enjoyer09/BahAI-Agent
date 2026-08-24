import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, Mic, Paperclip, Send, Square, X } from 'lucide-react';
import type { Attachment } from '../../lib/types';
import type { JobStatusState } from '../../store/chatService';
import type { JobStatus } from '../../lib/jobTypes';
import { useToast } from '../common/Toast';

interface ComposerProps {
  onSendMessage: (text: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  isGenerating?: boolean;
  onStop?: () => void;
  settings?: any;
  // Durable background-job status (web chat): shows queued/running/retrying/
  // cancelled/completed and exposes a cancel affordance.
  jobStatus?: JobStatusState | null;
  onCancelJob?: () => void;
  // Optional Voice Mode entry point (web_chat, when Speech API is available).
  // Rendered inline (left of the send button) so it never overlaps on mobile.
  onVoiceMode?: () => void;
}

// Localized labels + tone per durable job status.
const JOB_STATUS_META: Record<JobStatus, { label: string; tone: string }> = {
  queued: { label: 'Növbədə', tone: 'queued' },
  running: { label: 'İşlənir', tone: 'running' },
  retrying: { label: 'Təkrar cəhd', tone: 'retrying' },
  completed: { label: 'Tamamlandı', tone: 'completed' },
  failed: { label: 'Xəta', tone: 'failed' },
  cancelled: { label: 'Ləğv edildi', tone: 'cancelled' },
};

function JobStatusPill({
  status,
  queuePosition,
  errorMessage,
  onCancel,
}: {
  status: JobStatus;
  queuePosition?: number;
  errorMessage?: string | null;
  onCancel?: () => void;
}) {
  const meta = JOB_STATUS_META[status];
  const isActive = status === 'queued' || status === 'running' || status === 'retrying';
  const label =
    status === 'queued' && typeof queuePosition === 'number' && queuePosition > 0
      ? `${meta.label} · #${queuePosition}`
      : meta.label;

  return (
    <div
      className={`composer-job-status composer-job-status--${meta.tone}`}
      role="status"
      aria-live="polite"
    >
      <span className="composer-job-status-spinner">
        {status === 'completed' ? (
          <CheckCircle2 size={14} />
        ) : status === 'failed' ? (
          <AlertCircle size={14} />
        ) : status === 'cancelled' ? (
          <X size={14} />
        ) : (
          <Loader2 size={14} className="composer-job-spin" />
        )}
      </span>
      <span className="composer-job-status-label">{label}</span>
      {status === 'failed' && errorMessage && (
        <span className="composer-job-status-detail">{errorMessage}</span>
      )}
      {isActive && onCancel && (
        <button
          type="button"
          className="composer-job-cancel"
          onClick={onCancel}
          aria-label="Job-i ləğv et"
          title="Ləğv et"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
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

// Swipe-to-dismiss attachment chip. Pointer events cover mouse + touch. A
// leftward swipe past the threshold removes the chip; a smaller drag snaps back.
// The explicit X button remains the primary affordance (this is an enhancement).
const SWIPE_DISMISS_PX = 56;

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: (id: string) => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [removing, setRemoving] = useState(false);
  const startX = useRef<number | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    startX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (startX.current === null) return;
    const dx = event.clientX - startX.current;
    // Only leftward swipes are meaningful; rightward is damped so it feels
    // like a one-direction dismiss and never fights the tray.
    setDragX(dx < 0 ? dx : dx * 0.15);
  };
  const handlePointerUp = () => {
    if (startX.current === null) return;
    const dx = dragX;
    startX.current = null;
    if (dx <= -SWIPE_DISMISS_PX) {
      setDragX(0);
      setRemoving(true);
      window.setTimeout(() => onRemove(attachment.id), 160);
    } else {
      setDragX(0);
    }
  };

  return (
    <div
      className={`composer-attachment ${removing ? 'is-removing' : ''}`}
      style={{
        transform: dragX ? `translateX(${dragX}px)` : undefined,
        transition: dragX ? 'none' : 'transform 0.18s ease',
        touchAction: 'pan-y',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {attachment.type === 'image' ? (
        <img src={attachment.url} alt={attachment.name} draggable={false} />
      ) : (
        <div className="composer-file-preview">
          <FileText size={18} />
          <span>{attachment.name}</span>
        </div>
      )}
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        aria-label={`${attachment.name} faylını sil`}
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function Composer({ onSendMessage, disabled, isGenerating, onStop, settings, jobStatus, onCancelJob, onVoiceMode }: ComposerProps) {
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
    const isMobileView = window.innerWidth < 768;
    const maxH = isMobileView ? 120 : 160;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxH)}px`;
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
            <AttachmentChip key={attachment.id} attachment={attachment} onRemove={removeAttachment} />
          ))}
        </div>
      )}

      {jobStatus && (
        <JobStatusPill
          status={jobStatus.status}
          queuePosition={jobStatus.queuePosition}
          errorMessage={jobStatus.errorMessage}
          onCancel={onCancelJob || onStop}
        />
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
          accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.pptx,.csv,.txt,.md,.json,.yaml,.yml,.xml,.log"
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

        {onVoiceMode && (
          <button
            type="button"
            onClick={onVoiceMode}
            className="composer-icon-button composer-voice-button"
            title="Səs rejimi"
            aria-label="Səs rejimini aç"
          >
            <Mic size={18} />
          </button>
        )}

        {isGenerating ? (
          <button type="button" onClick={onStop} className="composer-send-button is-stop" aria-label="Stop generation">
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={disabled || (!text.trim() && attachments.length === 0)}
            className={`composer-send-button ${!disabled && (text.trim() || attachments.length > 0) ? 'composer-send-button--ready' : ''}`}
            aria-label="Send message"
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
