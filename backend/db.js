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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    } else if (process.env.NODE_ENV !== 'production') {
      const adminEmail = 'admin@bahai.az';
      const adminExists = await client.query('SELECT * FROM users WHERE email = $1', [adminEmail]);
      const hashedPw = await bcrypt.hash('Admin123!', 10);
      await client.query(
        `INSERT INTO users (email, password, name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [adminEmail, hashedPw, 'Local Administrator', 'admin']
      );
      if (adminExists.rows.length === 0) {
        console.log('✅ Local admin yaradıldı: admin@bahai.az / Admin123!');
      }
    } else {
      console.warn('⚠️ Production admin yaradılmadı. ADMIN_EMAIL və ADMIN_PASSWORD env-lərini təyin edin.');
    }

    console.log('✅ Verilənlər bazası strukturu hazırdır.');
  } catch (err) {
    console.error('❌ Database Init Error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = {
  query: (text, params) => {
    if (!pool) throw new Error('Database not configured');
    return pool.query(text, params);
  },
  initDb,
  pool,
  hasDatabase
};
