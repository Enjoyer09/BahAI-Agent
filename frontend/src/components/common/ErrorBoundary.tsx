// P2-FIX: Global Error Boundary for crash resilience + monitoring hook
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, retryCount: 0 };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
          <h2 className="text-lg font-semibold">Bir xəta baş verdi</h2>
          <p className="text-sm opacity-75">{this.state.error?.message || 'Gözlənilməz xəta'}</p>
          <button
            type="button"
            onClick={() => this.setState((state) => ({
              hasError: false,
              error: null,
              retryCount: state.retryCount + 1
            }))}
            className="rounded-md px-4 py-2"
          >
            Yenidən cəhd et
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
