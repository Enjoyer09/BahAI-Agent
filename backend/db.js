// ==========================================
// Database — PostgreSQL Connection & Schema
// ==========================================

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        repo_url TEXT,
        last_port INTEGER DEFAULT 5173,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        user_id INTEGER REFERENCES users(id),
        title TEXT NOT NULL,
        messages JSONB DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const adminEmail = 'admin@bahai.az';
    const adminExists = await client.query('SELECT * FROM users WHERE email = $1', [adminEmail]);
    
    if (adminExists.rows.length === 0) {
      const hashedPw = await bcrypt.hash('Admin123!', 10);
      await client.query(
        'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)',
        [adminEmail, hashedPw, 'Administrator', 'admin']
      );
      console.log('✅ Default Admin yaradıldı: admin@bahai.az / Admin123!');
    }

    console.log('✅ Verilənlər bazası strukturu hazırdır.');
  } catch (err) {
    console.error('❌ Database Init Error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  initDb,
  pool
};
