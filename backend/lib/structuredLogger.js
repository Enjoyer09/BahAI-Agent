// ==========================================
// Structured JSON logger
// ==========================================
// Emits one JSON object per log line so Railway/Datadog/any log aggregator can
// index level/timestamp/correlationId/fields instead of parsing prose. Falls
// back to pretty console output when STRUCTURED_LOGS !== 'true' (local dev).

function nowIso() {
  return new Date().toISOString();
}

function pickLevel(level) {
  return ['trace', 'debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
}

function write(level, message, fields) {
  const entry = {
    level,
    time: nowIso(),
    msg: message,
    ...(fields || {})
  };
  const line = JSON.stringify(entry);
  if (process.env.STRUCTURED_LOGS === 'true') {
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
    return;
  }
  // Human-readable local dev output: "time level msg (key=val ...)".
  const extra = fields && Object.keys(fields).length
    ? ' ' + Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')
    : '';
  const prefix = `${entry.time} ${level.toUpperCase()}`;
  if (level === 'error') console.error(`${prefix} ${message}${extra}`);
  else if (level === 'warn') console.warn(`${prefix} ${message}${extra}`);
  else console.log(`${prefix} ${message}${extra}`);
}

function child(baseFields) {
  const merge = (fields) => ({ ...(baseFields || {}), ...(fields || {}) });
  return {
    trace: (msg, fields) => write('trace', msg, merge(fields)),
    debug: (msg, fields) => write('debug', msg, merge(fields)),
    info: (msg, fields) => write('info', msg, merge(fields)),
    warn: (msg, fields) => write('warn', msg, merge(fields)),
    error: (msg, fields) => write('error', msg, merge(fields)),
    child: (more) => child(merge(more))
  };
}

const logger = {
  trace: (msg, fields) => write('trace', msg, fields),
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
  child,
};

module.exports = { logger, write, pickLevel };
