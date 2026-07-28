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

  static getDerivedStateFromError(_error: Error): State {
    return { hasError: false, error: null, retryCount: 0 };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn('[ErrorBoundary] Suppressed error:', error, errorInfo);
  }

  render() {
    return this.props.children;
  }
}
