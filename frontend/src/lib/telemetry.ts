// ==========================================
// Telemetry — Anonymous usage stats (opt-in)
// ==========================================

const TELEMETRY_URL = 'https://bahai-agent-production.up.railway.app/api/telemetry';
const APP_VERSION = '1.0.0';

// Generate a stable anonymous device ID (no personal info)
function getDeviceId(): string {
  let id = localStorage.getItem('telemetry_device_id');
  if (!id) {
    id = 'dev_' + crypto.randomUUID();
    localStorage.setItem('telemetry_device_id', id);
  }
  return id;
}

// Check if telemetry is enabled (user can opt-out)
function isEnabled(): boolean {
  return localStorage.getItem('telemetry_optout') !== '1';
}

// Send telemetry event (fire-and-forget, never blocks UI)
export function trackEvent(event: string, data?: Record<string, unknown>) {
  if (!isEnabled()) return;
  
  try {
    const payload = {
      event,
      data: data || {},
      deviceId: getDeviceId(),
      appVersion: APP_VERSION
    };

    // Use sendBeacon for reliability (doesn't block page unload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon(TELEMETRY_URL, JSON.stringify(payload));
    } else {
      fetch(TELEMETRY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(() => {}); // silently ignore errors
    }
  } catch {
    // Never throw — telemetry should never break the app
  }
}

// Convenience functions
export function trackChatMessage(model: string, responseTimeMs: number) {
  trackEvent('chat_message', { model, responseTimeMs });
}

export function trackChatError(model: string, errorCode: number | string) {
  trackEvent('chat_error', { model, errorCode });
}

export function trackToolUse(toolName: string) {
  trackEvent('tool_use', { tool: toolName });
}

export function trackAppOpen() {
  trackEvent('app_open', { platform: navigator.platform });
}

export function trackLogin(method: 'google' | 'email') {
  trackEvent('login', { method });
}

// Opt-out function (for settings panel)
export function setTelemetryOptOut(optOut: boolean) {
  if (optOut) {
    localStorage.setItem('telemetry_optout', '1');
  } else {
    localStorage.removeItem('telemetry_optout');
  }
}

export function isTelemetryEnabled(): boolean {
  return isEnabled();
}
