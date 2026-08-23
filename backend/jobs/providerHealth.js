// ==========================================
// Provider circuit breaker (per provider+model)
// ==========================================
// Protects any upstream provider from a retry storm when it is
// degraded. State lives in-memory and is authoritative for tripping; the
// existing `provider_health` table is updated best-effort for cross-restart
// continuity and ops visibility. A single worker process is sufficient because
// the breaker only needs to coordinate within that process's lease window.
//
//   closed  -> open    after `failureThreshold` consecutive failures
//   open    -> half_open after `cooldownMs`
//   half_open -> closed on success, -> open on next failure
//
// Cancellations (aborted requests) are NOT counted as provider failures.

function keyOf(providerId, model) {
  return `${providerId}|${model || ''}`;
}

function nowMs() {
  return Date.now();
}

function createProviderHealth({ db = null, env = {} } = {}) {
  const failureThreshold = Math.max(1, parseInt(env.BREAKER_FAILURE_THRESHOLD || '5', 10));
  const cooldownMs = Math.max(1000, parseInt(env.BREAKER_COOLDOWN_MS || '30000', 10));
  const halfOpenMax = Math.max(1, parseInt(env.BREAKER_HALF_OPEN_MAX || '1', 10));

  const store = new Map(); // key -> state object

  function ensure(key) {
    if (!store.has(key)) {
      store.set(key, {
        providerId: '',
        model: '',
        circuitState: 'closed',
        consecutiveFailures: 0,
        openUntil: 0,
        halfOpenAttempts: 0,
        ewmaLatencyMs: 0,
        lastStatus: null,
        lastErrorCode: null,
        updatedAt: nowMs()
      });
    }
    return store.get(key);
  }

  function persist(key, state) {
    if (!db || typeof db.query !== 'function') return;
    // Fire-and-forget; the breaker works fine without the table.
    db.query(
      `INSERT INTO provider_health
         (provider_id, model, circuit_state, consecutive_failures, open_until, ewma_latency_ms, last_status, last_error_code, updated_at)
       VALUES ($1,$2,$3,$4,to_timestamp($5/1000.0),$6,$7,$8,to_timestamp($9/1000.0))
       ON CONFLICT (provider_id, model) DO UPDATE SET
         circuit_state = EXCLUDED.circuit_state,
         consecutive_failures = EXCLUDED.consecutive_failures,
         open_until = EXCLUDED.open_until,
         ewma_latency_ms = EXCLUDED.ewma_latency_ms,
         last_status = EXCLUDED.last_status,
         last_error_code = EXCLUDED.last_error_code,
         updated_at = EXCLUDED.updated_at`,
      [
        state.providerId, state.model, state.circuitState, state.consecutiveFailures,
        state.openUntil, state.ewmaLatencyMs, state.lastStatus, state.lastErrorCode,
        state.updatedAt
      ]
    ).catch(() => {});
  }

  function update(providerId, model, mutate) {
    const key = keyOf(providerId, model);
    const state = ensure(key);
    state.providerId = providerId;
    state.model = model || '';
    mutate(state);
    state.updatedAt = nowMs();
    persist(key, state);
    return state;
  }

  function isTripWorthy(err) {
    if (!err) return false;
    // Aborted/cancelled requests are not provider faults.
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.message === 'cancelled') return false;
    const status = Number(err.status || 0);
    if (status >= 500) return true;
    if (status === 429) return true;
    if (status >= 400 && status < 500) return true; // 4xx counts as degradation
    // Network / timeout errors (no status) also count.
    return true;
  }

  return {
    // Should the caller skip this provider right now?
    isOpen(providerId, opts = {}) {
      const model = opts.model || '';
      const state = ensure(keyOf(providerId, model));
      if (state.circuitState === 'open') {
        if (nowMs() >= state.openUntil) {
          state.circuitState = 'half_open';
          state.halfOpenAttempts = 0;
          state.updatedAt = nowMs();
          persist(keyOf(providerId, model), state);
          return false; // allow one trial call
        }
        return true;
      }
      return false;
    },

    recordSuccess(providerId, opts = {}) {
      const model = opts.model || '';
      const latency = Number(opts.latencyMs || 0);
      update(providerId, model, (s) => {
        s.consecutiveFailures = 0;
        s.circuitState = 'closed';
        s.openUntil = 0;
        s.halfOpenAttempts = 0;
        s.lastStatus = opts.status || 200;
        s.lastErrorCode = null;
        if (latency > 0) {
          s.ewmaLatencyMs = s.ewmaLatencyMs === 0 ? latency : s.ewmaLatencyMs * 0.8 + latency * 0.2;
        }
      });
    },

    recordFailure(providerId, opts = {}) {
      const model = opts.model || '';
      if (opts.error && !isTripWorthy(opts.error)) {
        // Non-trip-worthy (e.g. cancellation) — just record status, don't trip.
        return;
      }
      update(providerId, model, (s) => {
        s.consecutiveFailures += 1;
        s.lastStatus = opts.status || (opts.error && opts.error.status) || null;
        s.lastErrorCode = opts.errorCode || (opts.error && opts.error.code) || null;
        if (s.circuitState === 'half_open') {
          s.halfOpenAttempts += 1;
          s.circuitState = 'open';
          s.openUntil = nowMs() + cooldownMs;
        } else if (s.consecutiveFailures >= failureThreshold) {
          s.circuitState = 'open';
          s.openUntil = nowMs() + cooldownMs;
        }
      });
    },

    recordLatency(providerId, latencyMs, opts = {}) {
      const model = opts.model || '';
      update(providerId, model, (s) => {
        const l = Number(latencyMs || 0);
        if (l > 0) s.ewmaLatencyMs = s.ewmaLatencyMs === 0 ? l : s.ewmaLatencyMs * 0.8 + l * 0.2;
      });
    },

    state(providerId, opts = {}) {
      const s = ensure(keyOf(providerId, opts.model || ''));
      return {
        providerId: s.providerId,
        model: s.model,
        circuitState: s.circuitState,
        consecutiveFailures: s.consecutiveFailures,
        openUntil: s.openUntil,
        ewmaLatencyMs: Math.round(s.ewmaLatencyMs),
        lastStatus: s.lastStatus,
        lastErrorCode: s.lastErrorCode,
        updatedAt: new Date(s.updatedAt).toISOString()
      };
    },

    snapshot() {
      return Array.from(store.values()).map((s) => ({
        providerId: s.providerId,
        model: s.model,
        circuitState: s.circuitState,
        consecutiveFailures: s.consecutiveFailures,
        openUntil: s.openUntil,
        ewmaLatencyMs: Math.round(s.ewmaLatencyMs),
        lastStatus: s.lastStatus,
        lastErrorCode: s.lastErrorCode,
        updatedAt: new Date(s.updatedAt).toISOString()
      }));
    },

    // Read breaker state persisted by any worker process (cross-process visibility
    // for the ops endpoint, which usually runs in the web process).
    async persistedStates() {
      if (!db || typeof db.query !== 'function') return [];
      try {
        const rows = await db.query(
          `SELECT provider_id, model, circuit_state, consecutive_failures, open_until,
                  ewma_latency_ms, last_status, last_error_code, updated_at
           FROM provider_health`
        );
        return (rows.rows || []).map((r) => ({
          providerId: r.provider_id,
          model: r.model,
          circuitState: r.circuit_state,
          consecutiveFailures: Number(r.consecutive_failures),
          openUntil: r.open_until ? new Date(r.open_until).getTime() : 0,
          ewmaLatencyMs: Math.round(Number(r.ewma_latency_ms || 0)),
          lastStatus: r.last_status,
          lastErrorCode: r.last_error_code,
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null
        }));
      } catch {
        return [];
      }
    }
  };
}

module.exports = { createProviderHealth, keyOf };
