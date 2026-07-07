// Notepad API — runs on the Cloudflare Workers runtime as a Pages Function.
// All /api/* requests route here. Storage is Cloudflare D1 (SQLite).

import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';

const COOKIE = 'notepad_token';
const app = new Hono().basePath('/api');

/* ------------------------------- utilities -------------------------------- */

const now = () => new Date().toISOString();

function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function ub64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  );
  return new Uint8Array(bits);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(hash)}`;
}
async function verifyPassword(password, stored) {
  const [scheme, iterStr, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const hash = await pbkdf2(password, ub64(saltB64), Number(iterStr));
  const a = b64(hash);
  if (a.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ hashB64.charCodeAt(i);
  return diff === 0;
}

function secret(c) {
  return c.env.JWT_SECRET || 'insecure-dev-secret-set-JWT_SECRET-in-production';
}

// Auth middleware — populates c.get('user') or returns 401.
async function requireAuth(c, next) {
  const token = getCookie(c, COOKIE) || (c.req.header('Authorization') || '').replace(/^Bearer /, '');
  if (!token) return c.json({ error: 'Not authenticated' }, 401);
  try {
    const payload = await verify(token, secret(c), 'HS256');
    const user = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(payload.uid).first();
    if (!user) return c.json({ error: 'User no longer exists' }, 401);
    c.set('user', user);
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }
}

async function issueSession(c, user) {
  const token = await sign(
    { uid: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 },
    secret(c), 'HS256'
  );
  setCookie(c, COOKIE, token, {
    httpOnly: true, sameSite: 'Lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30,
  });
  return token;
}

// Return the notebook if it belongs to the current user, else null.
async function ownedNotebook(c, id) {
  return c.env.DB
    .prepare('SELECT * FROM notebooks WHERE id = ? AND user_id = ?')
    .bind(Number(id), c.get('user').id)
    .first();
}

/* --------------------------- note / link parsing -------------------------- */

function parseLinks(content) {
  const re = /\[\[([^\[\]]+?)\]\]/g;
  const seen = new Map();
  let m;
  while ((m = re.exec(content)) !== null) {
    const title = m[1].trim();
    if (title && !seen.has(title.toLowerCase())) seen.set(title.toLowerCase(), title);
  }
  return [...seen.entries()].map(([titleLower, title]) => ({ title, titleLower }));
}

function indentOf(line) {
  const lead = (line.match(/^[ \t]*/) || [''])[0];
  return lead.replace(/\t/g, '  ').length;
}

// Context for a backlink: the line that mentions [[title]] PLUS every line
// nested beneath it (more deeply indented). This is what powers "pull in the
// bulleted items under a backlink" when you open the linked page.
function backlinkContext(content, titleLower) {
  const lines = content.split(/\r?\n/);
  const needle = `[[${titleLower}]]`;
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].toLowerCase().includes(needle)) continue;
    const base = indentOf(lines[i]);
    const block = [lines[i]];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '' && indentOf(lines[j]) > base) {
      block.push(lines[j]);
      j++;
    }
    blocks.push(block.join('\n'));
    i = j - 1;
  }
  return blocks.join('\n\n').trim();
}

// Rewrite the links table for one page (delete + reinsert), scoped to its
// notebook. D1 has no multi-statement prepare, so we batch.
async function syncLinks(db, notebookId, pageId, content) {
  const stmts = [db.prepare('DELETE FROM links WHERE source_page_id = ?').bind(pageId)];
  for (const { title, titleLower } of parseLinks(content)) {
    stmts.push(
      db.prepare(
        `INSERT INTO links (notebook_id, source_page_id, target_title, target_title_lower)
         VALUES (?, ?, ?, ?)`
      ).bind(notebookId, pageId, title, titleLower)
    );
  }
  await db.batch(stmts);
}

/* -------------------------------- serialize ------------------------------- */

function serialize(page) {
  return {
    id: page.id,
    notebookId: page.notebook_id,
    title: page.title,
    content: page.content,
    isDaily: !!page.is_daily,
    dailyDate: page.daily_date,
    createdAt: page.created_at,
    updatedAt: page.updated_at,
  };
}

async function withBacklinks(db, page) {
  const out = serialize(page);
  const { results } = await db
    .prepare(
      `SELECT DISTINCT p.id, p.title, p.content, p.is_daily, p.daily_date, p.updated_at
         FROM links l JOIN pages p ON p.id = l.source_page_id
        WHERE l.notebook_id = ? AND l.target_title_lower = ? AND p.id != ?
        ORDER BY p.updated_at DESC`
    )
    .bind(page.notebook_id, page.title_lower, page.id)
    .all();
  out.backlinks = (results || []).map((b) => ({
    id: b.id,
    title: b.title,
    isDaily: !!b.is_daily,
    dailyDate: b.daily_date,
    updatedAt: b.updated_at,
    context: backlinkContext(b.content, page.title_lower),
  }));
  return out;
}

async function createPage(db, notebookId, { title, isDaily = false, dailyDate = null, content = '' }) {
  const ts = now();
  const res = await db
    .prepare(
      `INSERT INTO pages (notebook_id, title, title_lower, content, is_daily, daily_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(notebookId, title, title.toLowerCase(), content, isDaily ? 1 : 0, dailyDate, ts, ts)
    .run();
  const id = res.meta.last_row_id;
  return db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first();
}

/* ---------------------------------- auth ---------------------------------- */

app.post('/auth/register', async (c) => {
  const { email = '', password = '' } = await c.req.json().catch(() => ({}));
  const mail = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return c.json({ error: 'Please enter a valid email address' }, 400);
  if (String(password).length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400);

  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(mail).first();
  if (exists) return c.json({ error: 'An account with that email already exists' }, 409);

  const ts = now();
  const res = await c.env.DB
    .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
    .bind(mail, await hashPassword(password), ts)
    .run();
  const user = { id: res.meta.last_row_id, email: mail };
  await c.env.DB.prepare('INSERT INTO notebooks (user_id, name, created_at) VALUES (?, ?, ?)')
    .bind(user.id, 'My Notes', ts).run();

  await issueSession(c, user);
  return c.json({ user });
});

app.post('/auth/login', async (c) => {
  const { email = '', password = '' } = await c.req.json().catch(() => ({}));
  const mail = String(email).trim().toLowerCase();
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(mail).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }
  await issueSession(c, { id: user.id, email: user.email });
  return c.json({ user: { id: user.id, email: user.email } });
});

app.post('/auth/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/auth/me', requireAuth, (c) => c.json({ user: c.get('user') }));

/* -------------------------------- notebooks ------------------------------- */

app.get('/notebooks', requireAuth, async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT n.*, (SELECT COUNT(*) FROM pages p WHERE p.notebook_id = n.id) AS page_count
         FROM notebooks n WHERE n.user_id = ? ORDER BY n.created_at ASC`
    )
    .bind(c.get('user').id)
    .all();
  return c.json((results || []).map((n) => ({ id: n.id, name: n.name, createdAt: n.created_at, pageCount: n.page_count })));
});

app.post('/notebooks', requireAuth, async (c) => {
  const { name = '' } = await c.req.json().catch(() => ({}));
  const nm = String(name).trim();
  if (!nm) return c.json({ error: 'Notebook name is required' }, 400);
  const ts = now();
  const res = await c.env.DB.prepare('INSERT INTO notebooks (user_id, name, created_at) VALUES (?, ?, ?)')
    .bind(c.get('user').id, nm, ts).run();
  return c.json({ id: res.meta.last_row_id, name: nm, createdAt: ts, pageCount: 0 });
});

app.patch('/notebooks/:nbId', requireAuth, async (c) => {
  const nb = await ownedNotebook(c, c.req.param('nbId'));
  if (!nb) return c.json({ error: 'Notebook not found' }, 404);
  const { name = '' } = await c.req.json().catch(() => ({}));
  const nm = String(name).trim();
  if (!nm) return c.json({ error: 'Notebook name is required' }, 400);
  await c.env.DB.prepare('UPDATE notebooks SET name = ? WHERE id = ?').bind(nm, nb.id).run();
  return c.json({ id: nb.id, name: nm });
});

app.delete('/notebooks/:nbId', requireAuth, async (c) => {
  const nb = await ownedNotebook(c, c.req.param('nbId'));
  if (!nb) return c.json({ error: 'Notebook not found' }, 404);
  const { c: count } = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM notebooks WHERE user_id = ?')
    .bind(c.get('user').id).first();
  if (count <= 1) return c.json({ error: 'You must keep at least one notebook' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM links WHERE notebook_id = ?').bind(nb.id),
    c.env.DB.prepare('DELETE FROM pages WHERE notebook_id = ?').bind(nb.id),
    c.env.DB.prepare('DELETE FROM notebooks WHERE id = ?').bind(nb.id),
  ]);
  return c.json({ ok: true });
});

/* ---------------------------------- pages --------------------------------- */

app.get('/notebooks/:nbId/pages', requireAuth, async (c) => {
  const nb = await ownedNotebook(c, c.req.param('nbId'));
  if (!nb) return c.json({ error: 'Notebook not found' }, 404);
  const q = String(c.req.query('q') || '').trim().toLowerCase();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = await c.env.DB.prepare(
      `SELECT * FROM pages WHERE notebook_id = ? AND (title_lower LIKE ? OR lower(content) LIKE ?)
       ORDER BY updated_at DESC LIMIT 100`
    ).bind(nb.id, like, like).all();
  } else {
    rows = await c.env.DB.prepare('SELECT * FROM pages WHERE notebook_id = ? ORDER BY updated_at DESC LIMIT 200')
      .bind(nb.id).all();
  }
  return c.json((rows.results || []).map(serialize));
});

app.get('/notebooks/:nbId/titles', requireAuth, async (c) => {
  const nb = await ownedNotebook(c, c.req.param('nbId'));
  if (!nb) return c.json({ error: 'Notebook not found' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT title, title_lower AS lower FROM pages WHERE notebook_id = ?
     UNION
     SELECT target_title AS title, target_title_lower AS lower FROM links WHERE notebook_id = ?`
  ).bind(nb.id, nb.id).all();
  const seen = new Map();
  for (const r of results || []) if (!seen.has(r.lower)) seen.set(r.lower, r.title);
  return c.json([...seen.values()].sort((a, b) => a.localeCompare(b)));
});

// Daily log feed: today (auto-created) + earlier days that have content.
app.get('/notebooks/:nbId/daily', requireAuth, async (c) => {
  const nb = await ownedNotebook(c, c.req.param('nbId'));
  if (!nb) return c.json({ error: 'Notebook not found' }, 404);
  const limit = Math.min(Number(c.req.query('limit')) || 14, 60);
  const before = String(c.req.query('before') || '');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('today') || '')
    ? c.req.query('today') : now().slice(0, 10);

  if (!before) {
    const existing = await c.env.DB
      .prepare('SELECT id FROM pages WHERE notebook_id = ? AND is_daily = 1 AND daily_date = ?')
      .bind(nb.id, today).first();
    if (!existing) await createPage(c.env.DB, nb.id, { title: today, isDaily: true, dailyDate: today });
  }

  const rows = before
    ? await c.env.DB.prepare(
        `SELECT * FROM pages WHERE notebook_id = ? AND is_daily = 1 AND daily_date < ?
           AND (content != '' OR daily_date = ?) ORDER BY daily_date DESC LIMIT ?`
      ).bind(nb.id, before, today, limit).all()
    : await c.env.DB.prepare(
        `SELECT * FROM pages WHERE notebook_id = ? AND is_daily = 1
           AND (content != '' OR daily_date = ?) ORDER BY daily_date DESC LIMIT ?`
      ).bind(nb.id, today, limit).all();

  const out = [];
  for (const p of rows.results || []) out.push(await withBacklinks(c.env.DB, p));
  return c.json(out);
});

app.get('/notebooks/:nbId/page', requireAuth, async (c) => {
  const nb = await ownedNotebook(c, c.req.param('nbId'));
  if (!nb) return c.json({ error: 'Notebook not found' }, 404);
  const title = String(c.req.query('title') || '').trim();
  if (!title) return c.json({ error: 'A page title is required' }, 400);
  let page = await c.env.DB.prepare('SELECT * FROM pages WHERE notebook_id = ? AND title_lower = ?')
    .bind(nb.id, title.toLowerCase()).first();
  if (!page) {
    if (c.req.query('create') === '1') page = await createPage(c.env.DB, nb.id, { title });
    else return c.json({ error: 'Page not found' }, 404);
  }
  return c.json(await withBacklinks(c.env.DB, page));
});

app.get('/notebooks/:nbId/pages/:id', requireAuth, async (c) => {
  const nb = await ownedNotebook(c, c.req.param('nbId'));
  if (!nb) return c.json({ error: 'Notebook not found' }, 404);
  const page = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ? AND notebook_id = ?')
    .bind(Number(c.req.param('id')), nb.id).first();
  if (!page) return c.json({ error: 'Page not found' }, 404);
  return c.json(await withBacklinks(c.env.DB, page));
});

app.post('/notebooks/:nbId/pages', requireAuth, async (c) => {
  const nb = await ownedNotebook(c, c.req.param('nbId'));
  if (!nb) return c.json({ error: 'Notebook not found' }, 404);
  const { title = '', content = '' } = await c.req.json().catch(() => ({}));
  const t = String(title).trim();
  if (!t) return c.json({ error: 'A page title is required' }, 400);
  const existing = await c.env.DB.prepare('SELECT * FROM pages WHERE notebook_id = ? AND title_lower = ?')
    .bind(nb.id, t.toLowerCase()).first();
  if (existing) return c.json(await withBacklinks(c.env.DB, existing));
  const page = await createPage(c.env.DB, nb.id, { title: t, content: String(content) });
  await syncLinks(c.env.DB, nb.id, page.id, page.content);
  const fresh = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(page.id).first();
  return c.json(await withBacklinks(c.env.DB, fresh));
});

app.put('/notebooks/:nbId/pages/:id', requireAuth, async (c) => {
  const nb = await ownedNotebook(c, c.req.param('nbId'));
  if (!nb) return c.json({ error: 'Notebook not found' }, 404);
  const page = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ? AND notebook_id = ?')
    .bind(Number(c.req.param('id')), nb.id).first();
  if (!page) return c.json({ error: 'Page not found' }, 404);
  const body = await c.req.json().catch(() => ({}));

  const content = body.content != null ? String(body.content) : page.content;
  let title = page.title;
  let titleLower = page.title_lower;
  if (!page.is_daily && body.title != null) {
    const nt = String(body.title).trim();
    if (!nt) return c.json({ error: 'Title cannot be empty' }, 400);
    const clash = await c.env.DB.prepare('SELECT id FROM pages WHERE notebook_id = ? AND title_lower = ?')
      .bind(nb.id, nt.toLowerCase()).first();
    if (clash && clash.id !== page.id) return c.json({ error: 'Another page already has that title' }, 409);
    title = nt;
    titleLower = nt.toLowerCase();
  }

  await c.env.DB.prepare('UPDATE pages SET title = ?, title_lower = ?, content = ?, updated_at = ? WHERE id = ?')
    .bind(title, titleLower, content, now(), page.id).run();
  await syncLinks(c.env.DB, nb.id, page.id, content);
  const fresh = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(page.id).first();
  return c.json(await withBacklinks(c.env.DB, fresh));
});

app.delete('/notebooks/:nbId/pages/:id', requireAuth, async (c) => {
  const nb = await ownedNotebook(c, c.req.param('nbId'));
  if (!nb) return c.json({ error: 'Notebook not found' }, 404);
  const page = await c.env.DB.prepare('SELECT id FROM pages WHERE id = ? AND notebook_id = ?')
    .bind(Number(c.req.param('id')), nb.id).first();
  if (!page) return c.json({ error: 'Page not found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM links WHERE source_page_id = ?').bind(page.id),
    c.env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(page.id),
  ]);
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => c.json({ error: err.message || 'Server error' }, 500));

export const onRequest = handle(app);
