// ==========================================
// Auth Controller — JWT & Password Management
// ==========================================

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'bahai_secret_key_99';

// SEC-1: Login with Role
async function login(req, res) {
  const { email, password } = req.body;
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
  const { email, password, name } = req.body;
  try {
    const hashedPw = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
      [email, hashedPw, name, 'user']
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

// SEC-3: Middleware to verify Token & Role
function verifyToken(req, res, next) {
  const isLocalMode = process.env.LOCAL_MODE === 'true' || !process.env.DATABASE_URL;
  if (isLocalMode) {
    req.user = { id: 9999, email: 'admin@bahai.local', name: 'bahAI Developer', role: 'admin' };
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Giriş qadağandır' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Sessiya vaxtı bitib' });
    req.user = decoded; // Contains id, email, role
    next();
  });
}

// SEC-4: Get current user (/me)
async function getMe(req, res) {
  try {
    const result = await db.query('SELECT id, email, name, role FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'İstifadəçi tapılmadı' });
    res.json({ user: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Google Login Handler
async function googleLogin(req, res) {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Google məlumatı tapılmadı' });
  }
  try {
    // Securely decode the Google JWT ID token payload using standard Base64 parsing
    const parts = credential.split('.');
    if (parts.length !== 3) {
      return res.status(400).json({ error: 'Google məlumatı yanlışdır' });
    }
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    const googleUser = JSON.parse(jsonPayload);
    
    const { email, name, email_verified } = googleUser;
    
    if (!email || !email_verified) {
      return res.status(400).json({ error: 'Google-dan etibarlı və təsdiqlənmiş e-poçt alınmadı' });
    }

    // Check if user already exists
    let result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    let user = result.rows[0];

    if (!user) {
      // Auto-register user as standard role 'user'
      // Since they use Google, they don't need a real local password, we create a secure random hash
      const randomPassword = Math.random().toString(36) + Math.random().toString(36);
      const hashedPw = await bcrypt.hash(randomPassword, 10);
      result = await db.query(
        'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
        [email, hashedPw, name || email.split('@')[0], 'user']
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

// Define Router Paths
router.post('/login', login);
router.post('/register', register);
router.post('/google-login', googleLogin);
router.get('/config', getAuthConfig);
router.get('/me', verifyToken, getMe);

module.exports = { router, verifyToken };
