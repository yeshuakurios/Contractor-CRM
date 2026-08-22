const bcrypt = require('bcrypt');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool } = require('./db');

function sessionMiddleware() {
  return session({
    store: new pgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

const loginAttempts = new Map(); // ip -> {count, resetAt}
function loginRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && now < entry.resetAt) {
    if (entry.count >= 10) {
      return res.status(429).json({ error: 'Too many login attempts, try again later.' });
    }
    entry.count += 1;
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  }
  next();
}

async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.userId = user.id;
  res.json({ ok: true });
}

function logout(req, res) {
  req.session.destroy(() => res.json({ ok: true }));
}

module.exports = { sessionMiddleware, requireAuth, loginRateLimit, login, logout };
