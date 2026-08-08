// ==========================================
// Auth Controller — JWT & Password Management
// ==========================================

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const crypto = require('crypto');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET production mühitində mütləq təyin olunmalıdır.');
}

// SEC-FIX: Avoid hardcoded fallback secret. If JWT_SECRET is not set (dev),
// generate a random one per process start so tokens become invalid on restart
// instead of being forgeable with a known constant.
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET təyin olunmayıb. Müvəqqəti random secret istifadə olunur — bütün tokenlər restart-da etibarsız olacaq.');
}

// Generate consistent user ID from email for local mode
function localUserId(email) {
  const hash = crypto.createHash('md5').update(email || 'admin@bahai.local').digest('hex');
  // Keep within PostgreSQL's signed 32-bit INTEGER range; an un-clamped MD5
  // prefix can exceed 2,147,483,647 and overflow the users/projects id columns.
  return (parseInt(hash.substring(0, 8), 16) % 2147483647) + 1;
}

const DEMO_EMAILS = new Set(['demo', 'demo@bahai.local', 'demo@bahai.az']);
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo123';

function isDemoEmail(email) {
  return DEMO_EMAILS.has(String(email || '').trim().toLowerCase());
}

function isDemoLoginEnabled() {
  return isLocalModeEnabled() || process.env.DEMO_LOGIN_ENABLED === 'true';
}

async function ensureDemoUser() {
  if (!db.hasDatabase()) {
    return { id: 9998, email: 'demo@bahai.local', name: 'Demo User', role: 'user' };
  }

  const demoEmail = process.env.DEMO_EMAIL || 'demo@bahai.az';
  const demoName = process.env.DEMO_NAME || 'Demo User';
  const normalizedEmail = demoEmail.toLowerCase();
  const existing = await db.query('SELECT id, email, name, role FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const hashedPw = await bcrypt.hash(DEMO_PASSWORD, 10);
  const inserted = await db.query(
    'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
    [normalizedEmail, hashedPw, demoName, 'user']
  );
  return inserted.rows[0];
}

// Helper: record login attempt
async function recordLogin(userId, email, success, method, req) {
  if (!db.hasDatabase()) return;
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    await db.query(
      'INSERT INTO login_history (user_id, email, success, ip_address, user_agent, method) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, email, success, ip, ua, method]
    );
  } catch { /* fire-and-forget */ }
}

// Helper: start or update a user session
async function touchSession(userId, req) {
  if (!db.hasDatabase()) return;
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    // Check if there's an active session (last_seen within 30 min)
    const existing = await db.query(
      `SELECT id FROM user_sessions 
       WHERE user_id = $1 AND ended_at IS NULL AND last_seen_at > NOW() - INTERVAL '30 minutes'
       ORDER BY started_at DESC LIMIT 1`,
      [userId]
    );
    if (existing.rows.length > 0) {
      // Update existing session
      await db.query(
        `UPDATE user_sessions SET last_seen_at = NOW(), duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at)) / 60
         WHERE id = $1`,
        [existing.rows[0].id]
      );
    } else {
      // Close any old open sessions for this user
      await db.query(
        `UPDATE user_sessions SET ended_at = last_seen_at, duration_minutes = EXTRACT(EPOCH FROM (last_seen_at - started_at)) / 60
         WHERE user_id = $1 AND ended_at IS NULL`,
        [userId]
      );
      // Start new session
      await db.query(
        'INSERT INTO user_sessions (user_id, ip_address, user_agent) VALUES ($1, $2, $3)',
        [userId, ip, ua]
      );
    }
  } catch { /* fire-and-forget */ }
}

// Helper: log error for admin visibility
async function logError(userId, email, errorType, errorMessage, endpoint, metadata) {
  if (!db.hasDatabase()) return;
  try {
    await db.query(
      'INSERT INTO error_logs (user_id, email, error_type, error_message, endpoint, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, email, errorType, errorMessage, endpoint, JSON.stringify(metadata || {})]
    );
  } catch { /* fire-and-forget */ }
}

// SEC-1: Login with Role
async function login(req, res) {
  const { email, password } = req.body;
  const isLocalMode = isLocalModeEnabled();

  // In local mode, auto-authenticate with any credentials
  if (isLocalMode) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const isDemoLogin = normalizedEmail === 'demo' || normalizedEmail === 'demo@bahai.local';
    if (isDemoLogin && password !== 'demo123') {
      recordLogin(null, normalizedEmail, false, 'local', req);
      return res.status(401).json({ error: 'Demo şifrəsi yanlışdır' });
    }

    // In local mode with database, try to find the real user first
    if (db.hasDatabase() && !isDemoLogin) {
      try {
        const dbResult = await db.query('SELECT id, email, name, role FROM users WHERE email = $1', [normalizedEmail || 'admin@bahai.az']);
        if (dbResult.rows.length > 0) {
          const dbUser = dbResult.rows[0];
          const tokens = generateTokenPair({ id: dbUser.id, email: dbUser.email, role: dbUser.role });
          recordLogin(dbUser.id, dbUser.email, true, 'local', req);
          touchSession(dbUser.id, req);
          return res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user: { id: dbUser.id, email: dbUser.email, name: dbUser.name, role: dbUser.role } });
        }
      } catch { /* fall through to local user */ }
    }

    const localEmail = isDemoLogin ? 'demo@bahai.local' : (email || 'admin@bahai.local');
    const uid = localUserId(localEmail);
    const localUser = { id: uid, email: localEmail, name: isDemoLogin ? 'Demo User' : (email?.split('@')[0] || 'User'), role: 'admin' };
    const tokens = generateTokenPair(localUser);
    recordLogin(uid, localEmail, true, 'local', req);
    touchSession(uid, req);
    return res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user: localUser });
  }

  try {
    if (isDemoEmail(email) && isDemoLoginEnabled()) {
      if (password !== DEMO_PASSWORD) {
        recordLogin(null, email, false, 'demo', req);
        return res.status(401).json({ error: 'Demo şifrəsi yanlışdır' });
      }
      const demoUser = await ensureDemoUser();
      const tokens = generateTokenPair({ id: demoUser.id, email: demoUser.email, role: demoUser.role });
      recordLogin(demoUser.id, demoUser.email, true, 'demo', req);
      touchSession(demoUser.id, req);
      return res.json({
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: { id: demoUser.id, email: demoUser.email, name: demoUser.name, role: demoUser.role }
      });
    }

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      recordLogin(user?.id || null, email, false, 'password', req);
      logError(user?.id || null, email, 'auth_failed', 'E-poçt və ya şifrə yanlışdır', '/api/auth/login', { email });
      return res.status(401).json({ error: 'E-poçt və ya şifrə yanlışdır' });
    }

    const tokens = generateTokenPair({ id: user.id, email: user.email, role: user.role });
    recordLogin(user.id, user.email, true, 'password', req);
    touchSession(user.id, req);

    res.json({
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (e) {
    console.error('Login Error:', e);
    logError(null, email, 'server_error', e.message, '/api/auth/login', {});
    res.status(500).json({ error: 'Server xətası baş verdi' });
  }
}

// SEC-2: Register (Default to 'user')
async function register(req, res) {
  const { email, password, name, fullName } = req.body;
  const displayName = name || fullName || email?.split('@')[0];
  const isLocalMode = isLocalModeEnabled();

  // In local mode, auto-register without database
  if (isLocalMode) {
    const localUser = { id: 9999, email: email || 'admin@bahai.local', name: displayName || 'bahAI Developer', role: 'admin' };
    const tokens = generateTokenPair(localUser);
    return res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user: localUser });
  }

  if (!email || !password) {
    return res.status(400).json({ error: 'Email və şifrə tələb olunur' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Şifrə ən azı 8 simvol olmalıdır' });
  }

  try {
    const hashedPw = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
      [email.toLowerCase(), hashedPw, displayName, 'user']
    );

    const user = result.rows[0];
    const tokens = generateTokenPair({ id: user.id, email: user.email, role: user.role });

    res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Bu e-poçt artıq qeydiyyatdan keçib' });
    console.error('Register Error:', e);
    res.status(500).json({ error: 'Server xətası baş verdi' });
  }
}

// SEC-FIX: LOCAL_MODE must be opt-in via env. Previously this also triggered
// whenever DATABASE_URL was missing, which on a cloud host would silently
// turn the deployment into an unauthenticated admin server.
function isLocalModeEnabled() {
  return process.env.LOCAL_MODE === 'true';
}

function localDevUser() {
  return { id: 9999, email: 'demo@bahai.local', name: 'Demo User', role: 'admin' };
}

// SEC-3: Middleware to verify Token & Role
function verifyToken(req, res, next) {
  const isLocalMode = isLocalModeEnabled();
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // If token exists, always verify it (even in local mode)
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Sessiya vaxtı bitib və ya etibarsızdır' });
      }
      req.user = decoded;
      
      // Update last_active timestamp (fire-and-forget)
      if (decoded.id && db.hasDatabase()) {
        db.query('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1', [decoded.id]).catch(() => {});
        // Touch session to track duration
        touchSession(decoded.id, req);
      }
      
      next();
    });
    return;
  }

  // No token — in LOCAL_MODE auto-login as a local admin (single-user dev
  // machine). On a real cloud deployment LOCAL_MODE must NOT be enabled.
  if (isLocalMode) {
    req.user = localDevUser();
    return next();
  }

  return res.status(401).json({ error: 'Giriş qadağandır' });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin icazəsi tələb olunur' });
  }
  next();
}

function requireWorkspaceAccess(req, res, next) {
  if (
    isLocalModeEnabled()
    || req.user?.role === 'admin'
    || process.env.ENABLE_SERVER_TOOLS === 'true'
  ) {
    return next();
  }
  return res.status(403).json({ error: 'Server workspace alətləri bu hesab üçün deaktivdir' });
}

// SEC-4: Get current user (/me)
async function getMe(req, res) {
  // If user info is already in the token (local mode), return it directly
  if (!db.hasDatabase() || isLocalModeEnabled()) {
    return res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name || req.user.email?.split('@')[0], role: req.user.role || 'user' } });
  }
  
  try {
    const result = await db.query('SELECT id, email, name, role FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      // SEC-FIX: User no longer exists in DB — do not trust the token's role
      // claim (could be a leftover admin token after user was deleted/demoted).
      return res.status(401).json({ error: 'İstifadəçi tapılmadı' });
    }
    res.json({ user: result.rows[0] });
  } catch (e) {
    // DB error — fallback to token info but force role='user' to avoid privilege
    // escalation if the DB is temporarily unavailable.
    res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name || req.user.email?.split('@')[0], role: 'user' } });
  }
}

// Google Login Handler
async function googleLogin(req, res) {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Google məlumatı tapılmadı' });
  }
  try {
    const tokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
    const tokenInfoResponse = await fetch(tokenInfoUrl);
    if (!tokenInfoResponse.ok) {
      return res.status(401).json({ error: 'Google token doğrulanmadı' });
    }
    const googleUser = await tokenInfoResponse.json();
    
    const { email, name, email_verified, aud } = googleUser;
    const expectedClientId = process.env.GOOGLE_CLIENT_ID;
    
    if (expectedClientId && aud !== expectedClientId) {
      return res.status(401).json({ error: 'Google client ID uyğun deyil' });
    }

    if (!email || (email_verified !== 'true' && email_verified !== true)) {
      return res.status(400).json({ error: 'Google-dan etibarlı və təsdiqlənmiş e-poçt alınmadı' });
    }

    // Check if user already exists
    let result = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    let user = result.rows[0];

    if (!user) {
      // Auto-register user as standard role 'user'
      // Since they use Google, they don't need a real local password, we create a secure random hash
      const randomPassword = Math.random().toString(36) + Math.random().toString(36);
      const hashedPw = await bcrypt.hash(randomPassword, 10);
      result = await db.query(
        'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
        [email.toLowerCase(), hashedPw, name || email.split('@')[0], 'user']
      );
      user = result.rows[0];
    }

    // Sign local JWT Token
    const tokens = generateTokenPair({ id: user.id, email: user.email, role: user.role });
    recordLogin(user.id, user.email, true, 'google', req);
    touchSession(user.id, req);

    res.json({
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (e) {
    console.error('Google Login Error:', e);
    logError(null, null, 'google_login_error', e.message, '/api/auth/google-login', {});
    res.status(500).json({ error: 'Google ilə daxil olarkən server xətası baş verdi' });
  }
}

// Public Auth Configuration
function getAuthConfig(req, res) {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    localMode: isLocalModeEnabled()
  });
}

function getPublicAppOrigin(req) {
  const configured = String(process.env.PUBLIC_APP_ORIGIN || process.env.APP_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'http';
  return `${proto}://${req.get('host')}`.replace(/\/$/, '');
}

// Desktop OAuth callback page - redirects token back to Electron via custom protocol
router.get('/desktop-callback', (req, res) => {
  // SEC-FIX: encodeURIComponent already escapes most things, but values
  // arriving on the query string must be sanitized before embedding in HTML.
  const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const token = encodeURIComponent(escapeHtml(req.query.token || ''));
  const user = encodeURIComponent(escapeHtml(req.query.user || ''));
  res.send(`<!DOCTYPE html>
<html>
<head><title>bahAI - Giriş uğurlu</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f0f0f; color: #fff; }
  .container { text-align: center; }
  h1 { color: #6366f1; }
  p { color: #999; margin-top: 12px; }
</style>
</head>
<body>
  <div class="container">
    <h1>✅ Giriş uğurlu!</h1>
    <p>bahAI tətbiqinə qayıdırsınız...</p>
  </div>
  <script>
    window.location.href = 'bahai://auth/callback?token=${token}&user=${user}';
    setTimeout(function() { window.close(); }, 3000);
  </script>
</body>
</html>`);
});

// Google OAuth for Desktop - no database needed, creates JWT from Google info
router.post('/google-login-desktop', async (req, res) => {
  if (!isLocalModeEnabled()) {
    return res.status(403).json({ error: 'Desktop Google girişi yalnız lokal rejimdə aktivdir' });
  }
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Google məlumatı tapılmadı' });
  }
  try {
    const tokenInfoUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential);
    const tokenInfoResponse = await fetch(tokenInfoUrl);
    if (!tokenInfoResponse.ok) {
      return res.status(401).json({ error: 'Google token doğrulanmadı' });
    }
    const googleUser = await tokenInfoResponse.json();
    const { email, name, email_verified } = googleUser;

    if (!email || (email_verified !== 'true' && email_verified !== true)) {
      return res.status(400).json({ error: 'Google-dan etibarlı e-poçt alınmadı' });
    }

    const user = { 
      id: Math.abs(email.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 99999), 
      email: email.toLowerCase(), 
      name: name || email.split('@')[0], 
      role: 'admin' 
    };
    const tokens = generateTokenPair(user);
    res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user });
  } catch (e) {
    console.error('Google Desktop Login Error:', e);
    res.status(500).json({ error: 'Google ilə daxil olarkən xəta' });
  }
});

// Google OAuth Authorization Code callback (for desktop/popup flow)
router.get('/google-callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).send('Authorization code tapılmadı');
  }

  try {
    let oauthState = {};
    try {
      oauthState = JSON.parse(String(state || '{}'));
    } catch {
      oauthState = {};
    }
    const isWebProduct = oauthState?.productMode === 'web_chat';
    const publicAppOrigin = getPublicAppOrigin(req);
    const redirectUri = `${publicAppOrigin}/api/auth/google-callback`;
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('Google token exchange failed:', err);
      return res.status(401).send('Google token alına bilmədi');
    }

    const tokens = await tokenResponse.json();
    const idToken = tokens.id_token;

    // Verify ID token
    const tokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    const verifyResponse = await fetch(tokenInfoUrl);
    if (!verifyResponse.ok) {
      return res.status(401).send('Google token doğrulanmadı');
    }

    const googleUser = await verifyResponse.json();
    const { email, name, email_verified } = googleUser;

    if (!email || (email_verified !== 'true' && email_verified !== true)) {
      return res.status(400).send('Etibarlı e-poçt alınmadı');
    }

    // Create JWT (works with or without database)
    const isLocalMode = isLocalModeEnabled();
    let user;

    if (isLocalMode) {
      user = {
        id: Math.abs(email.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 99999),
        email: email.toLowerCase(),
        name: name || email.split('@')[0],
        role: 'admin'
      };
    } else {
      // Check/create user in database
      let result = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
      if (result.rows.length === 0) {
        const hashedPw = await bcrypt.hash(Math.random().toString(36), 10);
        result = await db.query(
          'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
          [email.toLowerCase(), hashedPw, name || email.split('@')[0], 'user']
        );
      }
      user = result.rows[0];
    }

    const authTokens = generateTokenPair({ id: user.id, email: user.email, role: user.role });
    const jwtToken = authTokens.accessToken;

    // SEC-FIX: Token and user data must be HTML-/JS-safe. Use JSON.stringify
    // + replace `</` to neutralise `</script>` breakouts, and base64-encode
    // user blob so any quote/script-tag inside the Google name cannot break
    // out of the JSON literal.
    const safeJsonScript = (obj) =>
      JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    const payload = safeJsonScript({ token: jwtToken, refreshToken: authTokens.refreshToken, user, credential: idToken });
    // P2-FIX: Derive the allowed postMessage origin from ALLOWED_ORIGINS env
    // or the request origin. Using '*' is risky — any window could intercept.
    const postMessageOrigin = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean)[0]
      || publicAppOrigin;
    const safeOrigin = safeJsonScript(postMessageOrigin);
    res.send(`<!DOCTYPE html>
<html><head><title>bahAI Login</title></head>
<body>
<script>
  (function(){
    var data = ${payload};
    data.type = 'google-oauth-credential';
    var targetOrigin = ${safeOrigin};
    var isWebProduct = ${JSON.stringify(isWebProduct)};
    if (window.opener) {
      try {
        window.opener.postMessage(data, targetOrigin);
      } catch (e) {}
      try {
        if (window.opener.localStorage) {
          window.opener.localStorage.setItem('bahai_google_oauth_result', JSON.stringify(data));
        }
      } catch (e) {}
      setTimeout(function() {
        try { window.open('', '_self'); } catch (e) {}
        try { window.close(); } catch (e) {}
      }, 300);
    } else if (isWebProduct) {
      try {
        localStorage.setItem('bahai_google_oauth_result', JSON.stringify(data));
      } catch (e) {}
      document.body.innerHTML = '<p style="font-family:sans-serif;text-align:center;margin-top:40vh;color:#666;">Giriş tamamlandı. Əsas pəncərəyə qayıdın.</p>';
      setTimeout(function() {
        try { window.open('', '_self'); } catch (e) {}
        try { window.close(); } catch (e) {}
      }, 1200);
    } else {
      window.location.href = 'bahai://auth/callback?token=' + encodeURIComponent(data.token);
    }
  })();
</script>
<p style="font-family:sans-serif;text-align:center;margin-top:40vh;color:#666;">Giriş uğurlu! Pəncərə bağlanır...</p>
</body></html>`);
  } catch (e) {
    console.error('Google OAuth callback error:', e);
    res.status(500).send('Google ilə giriş zamanı xəta: ' + e.message);
  }
});

// SEC-FIX: production-grade auth rate limiter using `express-rate-limit`.
// 5 attempts / 15 min / IP for /login and /register to mitigate brute-force.
// Swap the store for redis on multi-instance deploys.
const rateLimit = require('express-rate-limit');
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çox cəhd olundu. 15 dəqiqə sonra yenidən cəhd edin.' },
  // Count only failed attempts so a user who logs in correctly isn't blocked.
  skipSuccessfulRequests: true
});

// ==========================================
// P1-FIX: JWT Refresh Token System
// Short-lived access token (1h) + longer refresh token (7d).
// On 401 the client calls /refresh to get a new pair without re-login.
// ==========================================
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '1h';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

function generateTokenPair(payload) {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  return { accessToken, refreshToken };
}

async function refreshTokenHandler(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token tələb olunur' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Etibarsız refresh token' });
    }

    // Re-issue tokens with fresh claims from DB (if available)
    let payload = { id: decoded.id, email: decoded.email, role: decoded.role };

    if (db.hasDatabase() && !isLocalModeEnabled()) {
      try {
        const result = await db.query('SELECT id, email, role FROM users WHERE id = $1', [decoded.id]);
        if (result.rows.length === 0) {
          return res.status(401).json({ error: 'İstifadəçi tapılmadı' });
        }
        payload = result.rows[0];
      } catch { /* fallback to token claims */ }
    }

    const tokens = generateTokenPair(payload);
    res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user: payload });
  } catch (e) {
    return res.status(401).json({ error: 'Refresh token vaxtı bitib. Yenidən daxil olun.' });
  }
}

// Define Router Paths
router.post('/login', authRateLimit, login);
router.post('/register', authRateLimit, register);
router.post('/google-login', googleLogin);
router.post('/refresh', refreshTokenHandler);
router.get('/config', getAuthConfig);
router.get('/me', verifyToken, getMe);

module.exports = {
  router,
  verifyToken,
  requireAdmin,
  requireWorkspaceAccess,
  generateTokenPair,
  logError,
  JWT_SECRET
};
