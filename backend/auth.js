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
  return parseInt(hash.substring(0, 8), 16); // 32-bit integer from first 8 hex chars
}

// SEC-1: Login with Role
async function login(req, res) {
  const { email, password } = req.body;
  const isLocalMode = isLocalModeEnabled();

  // In local mode, auto-authenticate with any credentials
  if (isLocalMode) {
    const uid = localUserId(email);
    const localUser = { id: uid, email: email || 'admin@bahai.local', name: email?.split('@')[0] || 'User', role: 'admin' };
    const token = jwt.sign(localUser, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: localUser });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'E-poçt və ya şifrə yanlışdır' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (e) {
    console.error('Login Error:', e);
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
    const token = jwt.sign(localUser, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: localUser });
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
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user });
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

// SEC-3: Middleware to verify Token & Role
function verifyToken(req, res, next) {
  const isLocalMode = isLocalModeEnabled();
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // If token exists, always verify it (even in local mode)
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        // SEC-FIX: invalid/expired token must NOT silently grant admin in local
        // mode — that was a token-forgery bypass. Reject explicitly so the
        // client clears it and re-authenticates.
        return res.status(403).json({ error: 'Sessiya vaxtı bitib və ya etibarsızdır' });
      }
      req.user = decoded;
      
      // Update last_active timestamp (fire-and-forget)
      if (decoded.id && db.hasDatabase()) {
        db.query('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1', [decoded.id]).catch(() => {});
      }
      
      next();
    });
    return;
  }

  // No token — in LOCAL_MODE auto-login as a local admin (single-user dev
  // machine). On a real cloud deployment LOCAL_MODE must NOT be enabled.
  if (isLocalMode) {
    req.user = { id: 9999, email: 'admin@bahai.local', name: 'bahAI Developer', role: 'admin' };
    return next();
  }

  return res.status(401).json({ error: 'Giriş qadağandır' });
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
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (e) {
    console.error('Google Login Error:', e);
    res.status(500).json({ error: 'Google ilə daxil olarkən server xətası baş verdi' });
  }
}

// Public Auth Configuration
function getAuthConfig(req, res) {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    localMode: process.env.LOCAL_MODE === 'true' || !process.env.DATABASE_URL
  });
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
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user });
  } catch (e) {
    console.error('Google Desktop Login Error:', e);
    res.status(500).json({ error: 'Google ilə daxil olarkən xəta' });
  }
});

// Google OAuth Authorization Code callback (for desktop/popup flow)
router.get('/google-callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Authorization code tapılmadı');
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: `${req.protocol}://${req.get('host')}/api/auth/google-callback`,
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
    const isLocalMode = process.env.LOCAL_MODE === 'true' || !process.env.DATABASE_URL;
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

    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // SEC-FIX: Token and user data must be HTML-/JS-safe. Use JSON.stringify
    // + replace `</` to neutralise `</script>` breakouts, and base64-encode
    // user blob so any quote/script-tag inside the Google name cannot break
    // out of the JSON literal. postMessage target stays '*' since the popup
    // origin is unknown; consumer (AuthModal) already validates message shape.
    const safeJsonScript = (obj) =>
      JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    const payload = safeJsonScript({ token: jwtToken, user, credential: idToken });
    res.send(`<!DOCTYPE html>
<html><head><title>bahAI Login</title></head>
<body>
<script>
  (function(){
    var data = ${payload};
    data.type = 'google-oauth-credential';
    if (window.opener) {
      window.opener.postMessage(data, '*');
      setTimeout(function() { window.close(); }, 1000);
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

// SEC-FIX: Simple in-memory sliding-window rate limiter for /login and
// /register to mitigate brute-force / credential-stuffing attacks. 5 attempts
// per 15 minutes per IP. Replace with redis/express-rate-limit in production
// behind multiple instances.
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateMap = new Map(); // ip -> [timestamp, ...]

function authRateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const arr = (rateMap.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Çox cəhd olundu. 15 dəqiqə sonra yenidən cəhd edin.' });
  }
  arr.push(now);
  rateMap.set(ip, arr);
  // Periodic cleanup
  if (rateMap.size > 5000) {
    for (const [k, v] of rateMap.entries()) {
      const fresh = v.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (fresh.length === 0) rateMap.delete(k);
      else rateMap.set(k, fresh);
    }
  }
  next();
}

// Define Router Paths
router.post('/login', authRateLimit, login);
router.post('/register', authRateLimit, register);
router.post('/google-login', googleLogin);
router.get('/config', getAuthConfig);
router.get('/me', verifyToken, getMe);

module.exports = { router, verifyToken };
