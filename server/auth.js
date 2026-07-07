import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import db from './db.js';

const COOKIE = 'notepad_token';
const TTL = '30d';

// For a self-hosted server, SET JWT_SECRET in the environment so sessions
// survive restarts. Otherwise we generate an ephemeral one (and warn).
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[notepad] JWT_SECRET not set — using a random secret; sessions reset on restart.');
}

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compareSync(pw, hash);
export const signToken = (user) => jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: TTL });

// Send the session cookie. `Secure` is enabled automatically when the request
// arrived over HTTPS (directly or via a trusted reverse proxy), and can be
// forced with COOKIE_SECURE=true. This lets login work over plain HTTP on an
// internal/VPN network while still being Secure once TLS is in front.
export function setAuthCookie(res, req, token) {
  const secure = process.env.COOKIE_SECURE === 'true'
    || req.secure
    || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure, path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function requireAuth(req, res, next) {
  let token = req.cookies?.[COOKIE];
  const header = req.headers.authorization;
  if (!token && header?.startsWith('Bearer ')) token = header.slice(7);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(payload.uid);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
