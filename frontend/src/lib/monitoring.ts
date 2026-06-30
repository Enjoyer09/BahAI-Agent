// ==========================================
// P2-FIX: Monitoring & Error Reporting Infrastructure
// Drop-in hook for Sentry, Datadog, or custom error tracking.
// Currently logs to console; replace init() body with your provider.
// ==========================================

interface MonitoringConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  enabled?: boolean;
}

let initialized = false;

/**
 * Initialize monitoring. Call once at app startup.
 * To integrate Sentry:
 *   1. npm install @sentry/react
 *   2. Replace the body of init() with Sentry.init(...)
 *   3. Replace captureException with Sentry.captureException
 */
export function initMonitoring(config: MonitoringConfig = {}) {
  if (initialized) return;
  initialized = true;

  const { enabled = true, environment = 'development' } = config;
  if (!enabled) return;

  // Register global error handler for ErrorBoundary integration
  (window as any).__BAHAI_ERROR_HANDLER = (error: Error, errorInfo?: any) => {
    captureException(error, { extra: errorInfo });
  };

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    captureException(event.reason || new Error('Unhandled rejection'), {
      extra: { promise: 'unhandledrejection' }
    });
  });

  // Global errors
  window.addEventListener('error', (event) => {
    captureException(event.error || new Error(event.message), {
      extra: { filename: event.filename, lineno: event.lineno }
    });
  });

  console.log(`[Monitoring] Initialized (env: ${environment})`);
}

/**
 * Capture an exception for reporting.
 * Replace with Sentry.captureException() or your provider's method.
 */
export function captureException(error: Error | unknown, context?: Record<string, any>) {
  // Placeholder: log to console. In production, send to Sentry/Datadog/etc.
  console.error('[Monitoring] Exception:', error, context);

  // Example Sentry integration:
  // Sentry.captureException(error, { extra: context });
}

/**
 * Capture a breadcrumb / event for analytics.
 */
export function captureEvent(name: string, data?: Record<string, any>) {
  // Placeholder: log for now
  if (import.meta.env.DEV) {
    console.debug(`[Monitoring] Event: ${name}`, data);
  }

  // Example Sentry integration:
  // Sentry.addBreadcrumb({ category: 'app', message: name, data });
}

/**
 * Set user context for error reports.
 */
export function setUser(_user: { id: number | string; email: string } | null) {
  // Example Sentry integration:
  // Sentry.setUser(user ? { id: String(user.id), email: user.email } : null);
}
