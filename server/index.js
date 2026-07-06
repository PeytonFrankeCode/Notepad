import express from 'express';
import cookieParser from 'cookie-parser';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import db from './db.js';
import {
  hashPassword, verifyPassword, signToken,
  setAuthCookie, clearAuthCookie, requireAuth,
} from './auth.js';
import { syncLinks, getBacklinks, backlinkContext } from './notes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const now = () => new Date().toISOString();

/* --------------------------------- helpers -------------------------------- */

// Returns the notebook if it belongs to the user, else null.
function ownedNotebook(userId, notebookId) {
  return db
    .prepare('SELECT * FROM notebooks WHERE id = ? AND user_id = ?')
    .get(notebookId, userId);
}

// Express param-style guard used by every notebook-scoped route.
function withNotebook(req, res) {
  const nb = ownedNotebook(req.user.id, Number(req.params.nbId));
  if (!nb) {
    res.status(404).json({ error: 'Notebook not found' });
    return null;
  }
  return nb;
}

function serializePage(page, { withBacklinks = false } = {}) {
  const out = {
    id: page.id,
    notebookId: page.notebook_id,
    title: page.title,
    content: page.content,
    isDaily: !!page.is_daily,
    dailyDate: page.daily_date,
    createdAt: page.created_at,
    updatedAt: page.updated_at,
  };
  if (withBacklinks) {
    out.backlinks = getBacklinks(page.notebook_id, page.title_lower, page.id).map((b) => ({
      id: b.id,
      title: b.title,
      isDaily: !!b.is_daily,
      dailyDate: b.daily_date,
      updatedAt: b.updated_at,
      context: backlinkContext(b.content, page.title_lower),
    }));
  }
  return out;
}

const findPageById = db.prepare('SELECT * FROM pages WHERE id = ? AND notebook_id = ?');
const findPageByTitle = db.prepare('SELECT * FROM pages WHERE notebook_id = ? AND title_lower = ?');

function createPage(notebookId, { title, isDaily = false, dailyDate = null, content = '' }) {
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO pages (notebook_id, title, title_lower, content, is_daily, daily_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(notebookId, title, title.toLowerCase(), content, isDaily ? 1 : 0, dailyDate, ts, ts);
  return findPageById.get(info.lastInsertRowid, notebookId);
}

/* ---------------------------------- auth ---------------------------------- */

app.post('/api/auth/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const ts = now();
  const info = db
    .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
    .run(email, hashPassword(password), ts);
  const user = { id: info.lastInsertRowid, email, created_at: ts };

  // Give every new user a starter notebook.
  db.prepare('INSERT INTO notebooks (user_id, name, created_at) VALUES (?, ?, ?)')
    .run(user.id, 'My Notes', ts);

  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ user: { id: user.id, email: user.email }, token });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ user: { id: user.id, email: user.email }, token });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

/* -------------------------------- notebooks ------------------------------- */

app.get('/api/notebooks', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.*, (SELECT COUNT(*) FROM pages p WHERE p.notebook_id = n.id) AS page_count
         FROM notebooks n WHERE n.user_id = ? ORDER BY n.created_at ASC`
    )
    .all(req.user.id);
  res.json(rows.map((n) => ({ id: n.id, name: n.name, createdAt: n.created_at, pageCount: n.page_count })));
});

app.post('/api/notebooks', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Notebook name is required' });
  const ts = now();
  const info = db
    .prepare('INSERT INTO notebooks (user_id, name, created_at) VALUES (?, ?, ?)')
    .run(req.user.id, name, ts);
  res.json({ id: info.lastInsertRowid, name, createdAt: ts, pageCount: 0 });
});

app.patch('/api/notebooks/:nbId', requireAuth, (req, res) => {
  const nb = withNotebook(req, res);
  if (!nb) return;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Notebook name is required' });
  db.prepare('UPDATE notebooks SET name = ? WHERE id = ?').run(name, nb.id);
  res.json({ id: nb.id, name });
});

app.delete('/api/notebooks/:nbId', requireAuth, (req, res) => {
  const nb = withNotebook(req, res);
  if (!nb) return;
  const count = db.prepare('SELECT COUNT(*) AS c FROM notebooks WHERE user_id = ?').get(req.user.id).c;
  if (count <= 1) {
    return res.status(400).json({ error: 'You must keep at least one notebook' });
  }
  db.prepare('DELETE FROM notebooks WHERE id = ?').run(nb.id);
  res.json({ ok: true });
});

/* ---------------------------------- pages --------------------------------- */

// All pages in a notebook (for the sidebar list + link autocomplete + search).
app.get('/api/notebooks/:nbId/pages', requireAuth, (req, res) => {
  const nb = withNotebook(req, res);
  if (!nb) return;
  const q = String(req.query.q || '').trim().toLowerCase();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db
      .prepare(
        `SELECT * FROM pages WHERE notebook_id = ?
           AND (title_lower LIKE ? OR lower(content) LIKE ?)
         ORDER BY updated_at DESC LIMIT 100`
      )
      .all(nb.id, like, like);
  } else {
    rows = db
      .prepare('SELECT * FROM pages WHERE notebook_id = ? ORDER BY updated_at DESC LIMIT 200')
      .all(nb.id);
  }
  res.json(rows.map((p) => serializePage(p)));
});

// Distinct link targets for [[ autocomplete: existing pages *and* any title
// that has been referenced anywhere in this notebook.
app.get('/api/notebooks/:nbId/titles', requireAuth, (req, res) => {
  const nb = withNotebook(req, res);
  if (!nb) return;
  const rows = db
    .prepare(
      `SELECT title, title_lower AS lower FROM pages WHERE notebook_id = ?
       UNION
       SELECT target_title AS title, target_title_lower AS lower FROM links WHERE notebook_id = ?`
    )
    .all(nb.id, nb.id);
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.lower)) seen.set(r.lower, r.title);
  res.json([...seen.values()].sort((a, b) => a.localeCompare(b)));
});

// The daily-notes feed: today (auto-created) + past days that have content.
app.get('/api/notebooks/:nbId/daily', requireAuth, (req, res) => {
  const nb = withNotebook(req, res);
  if (!nb) return;
  const limit = Math.min(Number(req.query.limit) || 14, 60);
  const before = String(req.query.before || ''); // YYYY-MM-DD, for "load more"

  // Ensure today's page exists so the user always has somewhere to write.
  const today = String(req.query.today || '').match(/^\d{4}-\d{2}-\d{2}$/)
    ? req.query.today
    : new Date().toISOString().slice(0, 10);
  if (!before) {
    let todayPage = db
      .prepare('SELECT id FROM pages WHERE notebook_id = ? AND is_daily = 1 AND daily_date = ?')
      .get(nb.id, today);
    if (!todayPage) createPage(nb.id, { title: today, isDaily: true, dailyDate: today });
  }

  const rows = before
    ? db.prepare(
        `SELECT * FROM pages WHERE notebook_id = ? AND is_daily = 1 AND daily_date < ?
           AND (content != '' OR daily_date = ?)
         ORDER BY daily_date DESC LIMIT ?`
      ).all(nb.id, before, today, limit)
    : db.prepare(
        `SELECT * FROM pages WHERE notebook_id = ? AND is_daily = 1
           AND (content != '' OR daily_date = ?)
         ORDER BY daily_date DESC LIMIT ?`
      ).all(nb.id, today, limit);

  res.json(rows.map((p) => serializePage(p, { withBacklinks: true })));
});

// Get (or create) a page by title — used when following a [[wiki link]].
app.get('/api/notebooks/:nbId/page', requireAuth, (req, res) => {
  const nb = withNotebook(req, res);
  if (!nb) return;
  const title = String(req.query.title || '').trim();
  if (!title) return res.status(400).json({ error: 'A page title is required' });
  let page = findPageByTitle.get(nb.id, title.toLowerCase());
  if (!page) {
    if (req.query.create === '1') page = createPage(nb.id, { title });
    else return res.status(404).json({ error: 'Page not found' });
  }
  res.json(serializePage(page, { withBacklinks: true }));
});

// Get a page by id.
app.get('/api/notebooks/:nbId/pages/:id', requireAuth, (req, res) => {
  const nb = withNotebook(req, res);
  if (!nb) return;
  const page = findPageById.get(Number(req.params.id), nb.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.json(serializePage(page, { withBacklinks: true }));
});

// Create a standalone (non-daily) page.
app.post('/api/notebooks/:nbId/pages', requireAuth, (req, res) => {
  const nb = withNotebook(req, res);
  if (!nb) return;
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'A page title is required' });
  const existing = findPageByTitle.get(nb.id, title.toLowerCase());
  if (existing) return res.json(serializePage(existing, { withBacklinks: true }));
  const page = createPage(nb.id, { title, content: String(req.body?.content || '') });
  syncLinks(nb.id, page.id, page.content);
  res.json(serializePage(findPageById.get(page.id, nb.id), { withBacklinks: true }));
});

// Update a page's content (and title for non-daily pages).
app.put('/api/notebooks/:nbId/pages/:id', requireAuth, (req, res) => {
  const nb = withNotebook(req, res);
  if (!nb) return;
  const page = findPageById.get(Number(req.params.id), nb.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });

  const content = req.body?.content != null ? String(req.body.content) : page.content;
  let title = page.title;
  let titleLower = page.title_lower;

  if (!page.is_daily && req.body?.title != null) {
    const newTitle = String(req.body.title).trim();
    if (!newTitle) return res.status(400).json({ error: 'Title cannot be empty' });
    const clash = findPageByTitle.get(nb.id, newTitle.toLowerCase());
    if (clash && clash.id !== page.id) {
      return res.status(409).json({ error: 'Another page already has that title' });
    }
    title = newTitle;
    titleLower = newTitle.toLowerCase();
  }

  db.prepare('UPDATE pages SET title = ?, title_lower = ?, content = ?, updated_at = ? WHERE id = ?')
    .run(title, titleLower, content, now(), page.id);
  syncLinks(nb.id, page.id, content);
  res.json(serializePage(findPageById.get(page.id, nb.id), { withBacklinks: true }));
});

app.delete('/api/notebooks/:nbId/pages/:id', requireAuth, (req, res) => {
  const nb = withNotebook(req, res);
  if (!nb) return;
  const page = findPageById.get(Number(req.params.id), nb.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  db.prepare('DELETE FROM pages WHERE id = ?').run(page.id);
  res.json({ ok: true });
});

/* --------------------------------- static --------------------------------- */

app.use(express.static(join(__dirname, '..', 'public')));

// SPA fallback for client-side routes.
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Notepad running at http://localhost:${PORT}`);
});
