// P2-FIX: Global Error Boundary for crash resilience + monitoring hook
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // P2: Hook point for Sentry/Datadog/custom monitoring
    console.error('[ErrorBoundary] Caught:', error, errorInfo);
    
    // If window.__BAHAI_ERROR_HANDLER exists (injected by monitoring setup), call it
    if (typeof window !== 'undefined' && (window as any).__BAHAI_ERROR_HANDLER) {
      (window as any).__BAHAI_ERROR_HANDLER(error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center min-h-[200px] p-6" style={{ background: 'var(--bg-surface)' }}>
          <div className="text-center max-w-md">
            <div className="text-2xl mb-2">⚠️</div>
            <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--fg-main)' }}>
              Bir xəta baş verdi
            </h3>
            <p className="text-xs mb-3" style={{ color: 'var(--fg-muted)' }}>
              {this.state.error?.message || 'Naməlum xəta'}
            </p>
            <button
              onClick={() => {
                if (this.state.error?.message?.includes('300') || this.state.error?.message?.includes('hook')) {
                  window.location.reload();
                } else {
                  this.setState({ hasError: false, error: null });
                }
              }}
              className="px-3 py-1.5 rounded text-xs font-medium"
              style={{ background: 'var(--color-accent)', color: 'white' }}
            >
              Yenidən cəhd et
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
