// ==========================================
// GitHub Route
// ==========================================

const express = require('express');
const router = express.Router();
const { decryptSecret, encryptSecret } = require('../helpers');
const db = require('../db');

// GET /api/github/status — Check GitHub connection status
router.get('/status', async (req, res) => {
  try {
    let connected = false;
    let username = null;

    if (db.hasDatabase()) {
      const result = await db.query('SELECT github_token_enc, github_username FROM users WHERE id = $1', [req.user.id]);
      const row = result.rows[0];
      if (row?.github_token_enc) {
        const token = decryptSecret(row.github_token_enc);
        connected = Boolean(token);
        username = row.github_username || null;
      }
    } else {
      connected = Boolean(process.env.GITHUB_TOKEN);
    }

    res.json({ connected, username, scopes: connected ? ['repo'] : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/github/connect — Connect GitHub account
router.post('/connect', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token tələb olunur' });

    // Validate token by fetching user info
    const response = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `token ${token}`, 'User-Agent': 'bahAI-Agent' }
    });
    if (!response.ok) return res.status(400).json({ error: 'Token keçərsizdir' });

    const githubUser = await response.json();
    const encrypted = encryptSecret(token);

    if (db.hasDatabase()) {
      await db.query(
        'UPDATE users SET github_token_enc = $1, github_username = $2 WHERE id = $3',
        [encrypted, githubUser.login, req.user.id]
      );
    }

    res.json({ success: true, username: githubUser.login });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/github/connect — Disconnect GitHub
router.delete('/connect', async (req, res) => {
  try {
    if (db.hasDatabase()) {
      await db.query('UPDATE users SET github_token_enc = NULL, github_username = NULL WHERE id = $1', [req.user.id]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/github/repos — List user repos
router.get('/repos', async (req, res) => {
  try {
    let token = null;
    if (db.hasDatabase()) {
      const result = await db.query('SELECT github_token_enc FROM users WHERE id = $1', [req.user.id]);
      const encrypted = result.rows[0]?.github_token_enc;
      token = encrypted ? decryptSecret(encrypted) : null;
    } else {
      token = process.env.GITHUB_TOKEN;
    }

    if (!token) return res.status(401).json({ error: 'GitHub bağlantısı yoxdur' });

    const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=30', {
      headers: { 'Authorization': `token ${token}`, 'User-Agent': 'bahAI-Agent' }
    });
    if (!response.ok) return res.status(500).json({ error: 'GitHub API xətası' });

    const repos = await response.json();
    res.json({ repos: repos.map(r => ({ name: r.name, fullName: r.full_name, private: r.private, url: r.html_url, description: r.description })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
