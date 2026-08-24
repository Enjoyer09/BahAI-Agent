// ==========================================
// Database — PostgreSQL Connection & Schema
// ==========================================

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    })
  : null;

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL tapılmadı. Verilənlər bazası xüsusiyyətləri (Auth, Projects) işləməyəcək.');
    return;
  }

  const client = await pool.connect();
  try {
    console.log('🔄 Verilənlər bazası yoxlanılır...');
    // ... rest of schema creation ...
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'user',
        github_token_enc TEXT,
        github_username TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS github_token_enc TEXT
    `);

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS github_username TEXT
    `);

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_active TIMESTAMP
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        repo_url TEXT,
        last_port INTEGER DEFAULT 5173,
        archived BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        user_id INTEGER REFERENCES users(id),
        title TEXT NOT NULL,
        messages JSONB DEFAULT '[]',
        archived BOOLEAN DEFAULT false,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false
    `);

    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS summary_text TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false
    `);

    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        attachments JSONB DEFAULT '[]',
        tool_calls JSONB DEFAULT '[]',
        tool_call_id TEXT,
        timestamp BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
      ON conversations(user_id, updated_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_user_last_message
      ON conversations(user_id, last_message_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON messages(conversation_id, created_at ASC)
    `);

    // Covering index for conversation list queries:WHERE user_id = ? AND archived = false
    // ORDER BY pinned DESC, pinned_at DESC NULLS LAST, last_message_at DESC
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_list
      ON conversations(user_id, pinned DESC, pinned_at DESC NULLS LAST, last_message_at DESC)
      WHERE archived = false
    `);

    // Partial index for archived conversations (used by soft-delete queries)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_archived
      ON conversations(user_id, updated_at DESC)
      WHERE archived = true
    `);

    // Covering index for project-scoped conversation list
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_project_list
      ON conversations(user_id, project_id, pinned DESC, pinned_at DESC NULLS LAST, last_message_at DESC)
      WHERE archived = false
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        conversation_id TEXT REFERENCES conversations(id),
        filename TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        extracted_text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_memories (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        memory JSONB DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS telemetry (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL,
        event TEXT NOT NULL,
        data JSONB DEFAULT '{}',
        app_version TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Login history table — tracks every login attempt
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        email TEXT NOT NULL,
        success BOOLEAN DEFAULT true,
        ip_address TEXT,
        user_agent TEXT,
        method TEXT DEFAULT 'password',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_login_history_user_id
      ON login_history(user_id, created_at DESC)
    `);

    // User sessions table — tracks session start/end for duration calculation
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        duration_minutes INTEGER DEFAULT 0,
        ip_address TEXT,
        user_agent TEXT
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
      ON user_sessions(user_id, started_at DESC)
    `);

    // Error logs table — tracks user-facing errors
    await client.query(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        email TEXT,
        error_type TEXT NOT NULL,
        error_message TEXT NOT NULL,
        endpoint TEXT,
        stack_trace TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_error_logs_created
      ON error_logs(created_at DESC)
    `);

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (adminEmail && adminPassword) {
      const adminExists = await client.query('SELECT * FROM users WHERE email = $1', [adminEmail]);
      if (adminExists.rows.length === 0) {
        const hashedPw = await bcrypt.hash(adminPassword, 10);
        await client.query(
          'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)',
          [adminEmail, hashedPw, 'Administrator', 'admin']
        );
        console.log(`✅ Admin yaradıldı: ${adminEmail}`);
      }
    } else if (process.env.LOCAL_MODE === 'true') {
      // SEC-FIX: Only seed a default admin in explicit LOCAL_MODE (single-user
      // dev machine). Previously `NODE_ENV !== 'production'` was the gate,
      // which on hosts that don't set NODE_ENV created an admin with a public
      // password in the cloud database.
      const localAdminEmail = 'admin@bahai.az';
      const localAdminPassword = process.env.LOCAL_ADMIN_PASSWORD || 'Admin123!';
      const hashedPw = await bcrypt.hash(localAdminPassword, 10);
      await client.query(
        `INSERT INTO users (email, password, name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [localAdminEmail, hashedPw, 'Local Administrator', 'admin']
      );
      console.log(`✅ Local admin hazırdır: ${localAdminEmail}`);
    } else {
      console.warn('⚠️ Production admin yaradılmadı. ADMIN_EMAIL və ADMIN_PASSWORD env-lərini təyin edin.');
    }

    console.log('✅ Verilənlər bazası strukturu hazırdır.');

    // Durable background job tables — turn the synchronous SSE chat flow into a
    // queue-backed job system so work survives browser disconnect and web restart.
    await ensureJobTables(client);
  } catch (err) {
    console.error('❌ Database Init Error:', err.message);
  } finally {
    client.release();
  }
}

// Idempotent schema for the durable job layer. Each statement is CREATE IF NOT
// EXISTS / ADD COLUMN IF NOT EXISTS so re-running initDb on every boot is safe.
async function ensureJobTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      resource_class TEXT NOT NULL DEFAULT 'text',
      priority INTEGER NOT NULL DEFAULT 1,
      payload JSONB NOT NULL DEFAULT '{}',
      result JSONB,
      error_code TEXT,
      error_message TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      cancel_requested_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      idempotency_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_idempotency
    ON agent_jobs (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_job_events (
      id BIGSERIAL PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
      seq BIGINT NOT NULL,
      type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (job_id, seq)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS provider_health (
      provider_id TEXT NOT NULL,
      model TEXT,
      circuit_state TEXT NOT NULL DEFAULT 'closed',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      open_until TIMESTAMPTZ,
      ewma_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
      last_status INTEGER,
      last_error_code TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (provider_id, model)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS user_usage_windows (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      window_start TIMESTAMPTZ NOT NULL,
      accepted_jobs INTEGER NOT NULL DEFAULT 0,
      active_jobs INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, window_start)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_claim
    ON agent_jobs (status, priority, available_at, created_at)
    WHERE status IN ('queued', 'retrying')
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_owner_status
    ON agent_jobs (lease_owner, status) WHERE lease_owner IS NOT NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_job_events_job_seq
    ON agent_job_events (job_id, seq)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_user_status
    ON agent_jobs (user_id, status)
  `);
}

module.exports = {
  query: (text, params) => {
    if (!pool) throw new Error('Database not configured');
    return pool.query(text, params);
  },
  initDb,
  pool,
  hasDatabase,
  // SEC-FIX: graceful shutdown so PG connections do not leak on SIGTERM.
  shutdown: async () => {
    if (pool) {
      try { await pool.end(); } catch { /* ignore */ }
    }
  }
};
