// Self-hosted Notepad server (Node + Express + SQLite). Serves the same
// frontend and API as the Cloudflare build. Intended to run on an internal
// host reachable only over your VPN.

import express from 'express';
import cookieParser from 'cookie-parser';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import db from './db.js';
import { hashPassword, verifyPassword, signToken, setAuthCookie, clearAuthCookie, requireAuth } from './auth.js';
import { syncLinks, getBacklinks, backlinkContext } from './notes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback'); // for X-Forwarded-* behind a reverse proxy
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const now = () => new Date().toISOString();

/* --------------------------------- helpers -------------------------------- */

function ownedNotebook(userId, id) {
  return db.prepare('SELECT * FROM notebooks WHERE id = ? AND user_id = ?').get(Number(id), userId);
}
function withNotebook(req, res) {
  const nb = ownedNotebook(req.user.id, req.params.nbId);
  if (!nb) { res.status(404).json({ error: 'Notebook not found' }); return null; }
  return nb;
}

const findPageById = db.prepare('SELECT * FROM pages WHERE id = ? AND notebook_id = ?');
const findPageByTitle = db.prepare('SELECT * FROM pages WHERE notebook_id = ? AND title_lower = ?');

function createPage(notebookId, { title, isDaily = false, dailyDate = null, content = '' }) {
  const ts = now();
  const info = db.prepare(
    `INSERT INTO pages (notebook_id, title, title_lower, content, is_daily, daily_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(notebookId, title, title.toLowerCase(), content, isDaily ? 1 : 0, dailyDate, ts, ts);
  return findPageById.get(info.lastInsertRowid, notebookId);
}

function serialize(p) {
  return {
    id: p.id, notebookId: p.notebook_id, title: p.title, content: p.content,
    isDaily: !!p.is_daily, dailyDate: p.daily_date, createdAt: p.created_at, updatedAt: p.updated_at,
  };
}
function withBacklinks(page) {
  const out = serialize(page);
  out.backlinks = getBacklinks(page.notebook_id, page.title_lower, page.id).map((b) => ({
    id: b.id, title: b.title, isDaily: !!b.is_daily, dailyDate: b.daily_date,
    updatedAt: b.updated_at, context: backlinkContext(b.content, page.title_lower),
  }));
  return out;
}

// When a page is renamed, rewrite every [[old title]] reference in the notebook
// to [[new title]] so links stay intact everywhere.
function renameReferences(notebookId, oldLower, newTitle) {
  const srcs = db.prepare('SELECT DISTINCT source_page_id AS id FROM links WHERE notebook_id = ? AND target_title_lower = ?')
    .all(notebookId, oldLower);
  const upd = db.prepare('UPDATE pages SET content = ?, updated_at = ? WHERE id = ?');
  for (const { id } of srcs) {
    const pg = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
    if (!pg) continue;
    const rewritten = pg.content.replace(/\[\[\s*([^\[\]]+?)\s*\]\]/g,
      (m, inner) => (inner.trim().toLowerCase() === oldLower ? `[[${newTitle}]]` : m));
    if (rewritten !== pg.content) {
      upd.run(rewritten, now(), id);
      syncLinks(notebookId, id, rewritten);
    }
  }
}

/* ---------------------------------- auth ---------------------------------- */

app.post('/api/auth/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with that email already exists' });

  const ts = now();
  const info = db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
    .run(email, hashPassword(password), ts);
  const user = { id: info.lastInsertRowid, email };
  db.prepare('INSERT INTO notebooks (user_id, name, created_at) VALUES (?, ?, ?)').run(user.id, 'My Notes', ts);
  setAuthCookie(res, req, signToken(user));
  res.json({ user });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  setAuthCookie(res, req, signToken(user));
  res.json({ user: { id: user.id, email: user.email } });
});

app.post('/api/auth/logout', (req, res) => { clearAuthCookie(res); res.json({ ok: true }); });
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

/* -------------------------------- notebooks ------------------------------- */

app.get('/api/notebooks', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT n.*, (SELECT COUNT(*) FROM pages p WHERE p.notebook_id = n.id) AS page_count
       FROM notebooks n WHERE n.user_id = ? ORDER BY n.created_at ASC`
  ).all(req.user.id);
  res.json(rows.map((n) => ({ id: n.id, name: n.name, createdAt: n.created_at, pageCount: n.page_count })));
});

app.post('/api/notebooks', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Notebook name is required' });
  const ts = now();
  const info = db.prepare('INSERT INTO notebooks (user_id, name, created_at) VALUES (?, ?, ?)').run(req.user.id, name, ts);
  res.json({ id: info.lastInsertRowid, name, createdAt: ts, pageCount: 0 });
});

app.patch('/api/notebooks/:nbId', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Notebook name is required' });
  db.prepare('UPDATE notebooks SET name = ? WHERE id = ?').run(name, nb.id);
  res.json({ id: nb.id, name });
});

app.delete('/api/notebooks/:nbId', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  if (db.prepare('SELECT COUNT(*) AS c FROM notebooks WHERE user_id = ?').get(req.user.id).c <= 1) {
    return res.status(400).json({ error: 'You must keep at least one notebook' });
  }
  db.prepare('DELETE FROM notebooks WHERE id = ?').run(nb.id); // cascades to pages + links
  res.json({ ok: true });
});

/* ---------------------------------- pages --------------------------------- */

app.get('/api/notebooks/:nbId/pages', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  const q = String(req.query.q || '').trim().toLowerCase();
  const rows = q
    ? db.prepare(`SELECT * FROM pages WHERE notebook_id = ? AND (title_lower LIKE ? OR lower(content) LIKE ?) ORDER BY updated_at DESC LIMIT 100`)
        .all(nb.id, `%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM pages WHERE notebook_id = ? ORDER BY updated_at DESC LIMIT 200').all(nb.id);
  res.json(rows.map(serialize));
});

app.get('/api/notebooks/:nbId/titles', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  const rows = db.prepare(
    `SELECT title, title_lower AS lower FROM pages WHERE notebook_id = ?
     UNION
     SELECT target_title AS title, target_title_lower AS lower FROM links WHERE notebook_id = ?`
  ).all(nb.id, nb.id);
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.lower)) seen.set(r.lower, r.title);
  res.json([...seen.values()].sort((a, b) => a.localeCompare(b)));
});

app.get('/api/notebooks/:nbId/daily', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  const limit = Math.min(Number(req.query.limit) || 14, 60);
  const before = String(req.query.before || '');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(req.query.today || '') ? req.query.today : now().slice(0, 10);

  if (!before && !db.prepare('SELECT id FROM pages WHERE notebook_id = ? AND is_daily = 1 AND daily_date = ?').get(nb.id, today)) {
    createPage(nb.id, { title: today, isDaily: true, dailyDate: today });
  }
  const rows = before
    ? db.prepare(`SELECT * FROM pages WHERE notebook_id = ? AND is_daily = 1 AND daily_date < ? AND (content != '' OR daily_date = ?) ORDER BY daily_date DESC LIMIT ?`).all(nb.id, before, today, limit)
    : db.prepare(`SELECT * FROM pages WHERE notebook_id = ? AND is_daily = 1 AND (content != '' OR daily_date = ?) ORDER BY daily_date DESC LIMIT ?`).all(nb.id, today, limit);
  res.json(rows.map(withBacklinks));
});

// Get (or create) the daily entry for a specific date — used to jump to any
// day, including past days that aren't in the recent feed yet.
app.get('/api/notebooks/:nbId/daily/:date', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  const date = String(req.params.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
  let page = db.prepare('SELECT * FROM pages WHERE notebook_id = ? AND is_daily = 1 AND daily_date = ?').get(nb.id, date);
  if (!page) page = createPage(nb.id, { title: date, isDaily: true, dailyDate: date });
  res.json(withBacklinks(page));
});

app.get('/api/notebooks/:nbId/page', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  const title = String(req.query.title || '').trim();
  if (!title) return res.status(400).json({ error: 'A page title is required' });
  let page = findPageByTitle.get(nb.id, title.toLowerCase());
  if (!page) {
    if (req.query.create === '1') page = createPage(nb.id, { title });
    else return res.status(404).json({ error: 'Page not found' });
  }
  res.json(withBacklinks(page));
});

app.get('/api/notebooks/:nbId/pages/:id', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  const page = findPageById.get(Number(req.params.id), nb.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.json(withBacklinks(page));
});

app.post('/api/notebooks/:nbId/pages', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'A page title is required' });
  const existing = findPageByTitle.get(nb.id, title.toLowerCase());
  if (existing) return res.json(withBacklinks(existing));
  const page = createPage(nb.id, { title, content: String(req.body?.content || '') });
  syncLinks(nb.id, page.id, page.content);
  res.json(withBacklinks(findPageById.get(page.id, nb.id)));
});

app.put('/api/notebooks/:nbId/pages/:id', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  const page = findPageById.get(Number(req.params.id), nb.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });

  const content = req.body?.content != null ? String(req.body.content) : page.content;
  let title = page.title;
  let titleLower = page.title_lower;
  let renamedFrom = null;
  if (!page.is_daily && req.body?.title != null) {
    const nt = String(req.body.title).trim();
    if (!nt) return res.status(400).json({ error: 'Title cannot be empty' });
    const clash = findPageByTitle.get(nb.id, nt.toLowerCase());
    if (clash && clash.id !== page.id) return res.status(409).json({ error: 'Another page already has that title' });
    if (nt.toLowerCase() !== page.title_lower) renamedFrom = page.title_lower;
    title = nt; titleLower = nt.toLowerCase();
  }
  db.prepare('UPDATE pages SET title = ?, title_lower = ?, content = ?, updated_at = ? WHERE id = ?')
    .run(title, titleLower, content, now(), page.id);
  syncLinks(nb.id, page.id, content);
  if (renamedFrom) renameReferences(nb.id, renamedFrom, title);
  res.json(withBacklinks(findPageById.get(page.id, nb.id)));
});

app.delete('/api/notebooks/:nbId/pages/:id', requireAuth, (req, res) => {
  const nb = withNotebook(req, res); if (!nb) return;
  const page = findPageById.get(Number(req.params.id), nb.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  db.prepare('DELETE FROM pages WHERE id = ?').run(page.id); // cascades to links
  res.json({ ok: true });
});

/* --------------------------------- static --------------------------------- */

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`Notepad (self-hosted) listening on http://${HOST}:${PORT}`));
