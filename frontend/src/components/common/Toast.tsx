import { useState, useCallback, useEffect, createContext, useContext, useRef } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const ICONS: Record<ToastType, React.ComponentType<{ size?: number; className?: string }>> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const ICON_COLORS: Record<ToastType, string> = {
  success: 'text-green-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-blue-400',
};

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const Icon = ICONS[t.type];

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(t.id), t.duration || 4000);
    return () => clearTimeout(timer);
  }, [t.id, t.duration, onDismiss]);

  return (
    <div className={`toast toast-${t.type}`}>
      <Icon size={18} className={ICON_COLORS[t.type]} />
      <span className="flex-1">{t.message}</span>
      <button
        onClick={() => onDismiss(t.id)}
        className="opacity-50 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = `toast-${++counterRef.current}`;
    setToasts(prev => [...prev, { id, type, message, duration }]);
  }, []);

  const ctx: ToastContextValue = {
    toast: addToast,
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error'),
    warning: (msg) => addToast(msg, 'warning'),
    info: (msg) => addToast(msg, 'info'),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* Confirm dialog replacement */
export function useConfirm() {
  const [state, setState] = useState<{
    resolve: (value: boolean) => void;
    message: string;
    title?: string;
    variant?: 'danger' | 'default';
  } | null>(null);

  const confirm = useCallback((message: string, title?: string, variant?: 'danger' | 'default'): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ resolve, message, title, variant: variant || 'default' });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  const ConfirmDialog = state ? (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" onClick={handleCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6 max-w-sm w-full shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {state.title && (
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--fg-main)' }}>
            {state.title}
          </h3>
        )}
        <p className="text-sm mb-6" style={{ color: 'var(--fg-secondary)' }}>
          {state.message}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm rounded-[var(--radius-md)] transition-colors"
            style={{ color: 'var(--fg-secondary)', background: 'var(--bg-hover)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            autoFocus
            className="px-4 py-2 text-sm rounded-[var(--radius-md)] text-white transition-colors"
            style={{
              background: state.variant === 'danger' ? 'var(--color-danger)' : 'var(--color-accent)',
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, ConfirmDialog };
}
