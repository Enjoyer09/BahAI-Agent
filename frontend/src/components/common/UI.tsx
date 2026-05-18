import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/* ==========================================
   BUTTON
   ========================================== */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

const variantStyles: Record<string, React.CSSProperties> = {
  primary: {
    background: 'var(--color-accent)',
    color: 'var(--fg-on-accent)',
    border: '1px solid transparent',
  },
  secondary: {
    background: 'var(--bg-hover)',
    color: 'var(--fg-main)',
    border: '1px solid var(--border)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--fg-secondary)',
    border: '1px solid transparent',
  },
  danger: {
    background: 'rgba(239, 68, 68, 0.1)',
    color: '#ef4444',
    border: '1px solid rgba(239, 68, 68, 0.2)',
  },
};

const sizeStyles: Record<string, React.CSSProperties> = {
  sm: { padding: '4px 10px', fontSize: '12px', borderRadius: 'var(--radius-sm)' },
  md: { padding: '8px 16px', fontSize: '13px', borderRadius: 'var(--radius-md)' },
  lg: { padding: '10px 20px', fontSize: '14px', borderRadius: 'var(--radius-md)' },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', loading, icon, children, style, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      style={{
        ...variantStyles[variant],
        ...sizeStyles[size],
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s ease',
        whiteSpace: 'nowrap',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.opacity = '0.85';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = disabled ? '0.5' : '1';
      }}
      {...props}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  )
);

Button.displayName = 'Button';

/* ==========================================
   SPINNER
   ========================================== */
export function Spinner({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <Loader2
      size={size}
      className={`animate-spin ${className}`}
      style={{ animation: 'spin 0.8s linear infinite' }}
    />
  );
}

/* ==========================================
   BADGE
   ========================================== */
interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
  size?: 'sm' | 'md';
}

const badgeColors: Record<string, { bg: string; color: string }> = {
  default: { bg: 'var(--fg-faint)', color: 'var(--fg-secondary)' },
  success: { bg: 'rgba(34, 197, 94, 0.1)', color: '#4ade80' },
  warning: { bg: 'rgba(245, 158, 11, 0.1)', color: '#fbbf24' },
  danger: { bg: 'rgba(239, 68, 68, 0.1)', color: '#f87171' },
  info: { bg: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa' },
};

export function Badge({ variant = 'default', children, size = 'sm' }: BadgeProps) {
  const colors = badgeColors[variant];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: size === 'sm' ? '2px 8px' : '4px 12px',
        fontSize: size === 'sm' ? '11px' : '12px',
        fontWeight: 600,
        borderRadius: 'var(--radius-full)',
        background: colors.bg,
        color: colors.color,
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}

/* ==========================================
   KBD (Keyboard shortcut)
   ========================================== */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '20px',
        height: '20px',
        padding: '0 5px',
        fontSize: '11px',
        fontFamily: 'inherit',
        fontWeight: 500,
        borderRadius: '4px',
        background: 'var(--bg-hover)',
        border: '1px solid var(--border)',
        color: 'var(--fg-muted)',
      }}
    >
      {children}
    </kbd>
  );
}

/* ==========================================
   TOOLTIP
   ========================================== */
interface TooltipProps {
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

export function Tooltip({ content, side = 'top', children }: TooltipProps) {
  return (
    <div className="group relative inline-flex">
      {children}
      <div
        className="pointer-events-none absolute z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        style={{
          ...(side === 'top' && { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '6px' }),
          ...(side === 'bottom' && { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '6px' }),
          ...(side === 'left' && { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: '6px' }),
          ...(side === 'right' && { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: '6px' }),
        }}
      >
        <div
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            fontWeight: 500,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--fg-secondary)',
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {content}
        </div>
      </div>
    </div>
  );
}
