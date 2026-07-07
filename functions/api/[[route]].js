// The whole Notepad API as a single Cloudflare Pages Function. Every
// /api/* request lands here; data lives in a D1 (SQLite) database bound
// as `env.DB`. Auth uses WebCrypto only (PBKDF2 passwords, HS256 JWT in
// an httpOnly cookie) — the Workers runtime has no Node bcrypt/jwt.

const COOKIE_NAME = 'notepad_token';
const TOKEN_TTL_S = 30 * 24 * 60 * 60; // 30 days
const PBKDF2_ITERS = 100_000;

const enc = new TextEncoder();
const now = () => new Date().toISOString();

/* -------------------------------- schema ---------------------------------- */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notebooks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    title_lower TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    is_daily    INTEGER NOT NULL DEFAULT 0,
    daily_date  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(notebook_id, title_lower)
  )`,
  `CREATE TABLE IF NOT EXISTS links (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    notebook_id        INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    source_page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_title       TEXT NOT NULL,
    target_title_lower TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pages_notebook ON pages(notebook_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pages_daily    ON pages(notebook_id, is_daily, daily_date)`,
  `CREATE INDEX IF NOT EXISTS idx_links_target   ON links(notebook_id, target_title_lower)`,
  `CREATE INDEX IF NOT EXISTS idx_links_source   ON links(source_page_id)`,
];

let migrated = false; // once per isolate; statements are idempotent anyway
async function migrate(db) {
  if (migrated) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  migrated = true;
}

// Signing secret: prefer a JWT_SECRET env var; otherwise generate one once
// and persist it in D1 so sessions survive deploys with zero config.
let secretCache = null;
async function getSecret(env) {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (secretCache) return secretCache;
  const generated = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES ('jwt_secret', ?) ON CONFLICT(key) DO NOTHING`
  ).bind(generated).run();
  const row = await env.DB.prepare(`SELECT value FROM meta WHERE key = 'jwt_secret'`).first();
  secretCache = row.value;
  return secretCache;
}

/* ------------------------------ crypto: auth ------------------------------- */

const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64u = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256
  );
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERS);
  return `pbkdf2$${PBKDF2_ITERS}$${b64u(salt)}$${b64u(hash)}`;
}

async function verifyPassword(password, stored) {
  const [scheme, iters, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2') return false;
  const expected = unb64u(hashB64);
  const actual = await pbkdf2(password, unb64u(saltB64), Number(iters));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function signToken(user, secret) {
  const header = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64u(enc.encode(JSON.stringify({
    uid: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S,
  })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64u(sig)}`;
}

async function verifyToken(token, secret) {
  const [header, payload, sig] = String(token || '').split('.');
  if (!header || !payload || !sig) return null;
  const ok = await crypto.subtle.verify(
    'HMAC', await hmacKey(secret), unb64u(sig), enc.encode(`${header}.${payload}`)
  );
  if (!ok) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

function getCookie(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  for (const part of cookies.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

const authCookie = (token) =>
  `${COOKIE_NAME}=${token}; Path=/; Max-Age=${TOKEN_TTL_S}; HttpOnly; Secure; SameSite=Lax`;
const clearCookie = () =>
  `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

async function currentUser(request, env) {
  let token = getCookie(request, COOKIE_NAME);
  const auth = request.headers.get('Authorization');
  if (!token && auth?.startsWith('Bearer ')) token = auth.slice(7);
  if (!token) return null;
  const claims = await verifyToken(token, await getSecret(env));
  if (!claims) return null;
  return env.DB.prepare('SELECT id, email, created_at FROM users WHERE id = ?').bind(claims.uid).first();
}

/* --------------------------------- helpers -------------------------------- */

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const fail = (status, error) => json({ error }, status);

// Extract [[wiki links]], preserving first-seen display casing.
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

// Rewrite the links rows for a source page, scoped to its own notebook.
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

async function getBacklinks(db, notebookId, titleLower, selfPageId) {
  const { results } = await db.prepare(
    `SELECT DISTINCT p.id, p.title, p.content, p.is_daily, p.daily_date, p.updated_at
       FROM links l
       JOIN pages p ON p.id = l.source_page_id
      WHERE l.notebook_id = ? AND l.target_title_lower = ? AND p.id != ?
      ORDER BY p.updated_at DESC`
  ).bind(notebookId, titleLower, selfPageId ?? -1).all();
  return results;
}

// Snippet of the source content around a reference ("Linked references").
function backlinkContext(content, titleLower) {
  const lines = content.split(/\r?\n/);
  const hits = lines.filter((ln) => ln.toLowerCase().includes(`[[${titleLower}]]`));
  return (hits.length ? hits : lines.filter((ln) => ln.trim())).join('\n').trim();
}

async function serializePage(db, page, { withBacklinks = false } = {}) {
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
    const bls = await getBacklinks(db, page.notebook_id, page.title_lower, page.id);
    out.backlinks = bls.map((b) => ({
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

const findPageById = (db, id, nbId) =>
  db.prepare('SELECT * FROM pages WHERE id = ? AND notebook_id = ?').bind(id, nbId).first();
const findPageByTitle = (db, nbId, titleLower) =>
  db.prepare('SELECT * FROM pages WHERE notebook_id = ? AND title_lower = ?').bind(nbId, titleLower).first();

async function createPage(db, notebookId, { title, isDaily = false, dailyDate = null, content = '' }) {
  const ts = now();
  const { meta } = await db.prepare(
    `INSERT INTO pages (notebook_id, title, title_lower, content, is_daily, daily_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(notebookId, title, title.toLowerCase(), content, isDaily ? 1 : 0, dailyDate, ts, ts).run();
  return findPageById(db, meta.last_row_id, notebookId);
}

/* ---------------------------------- router --------------------------------- */

export async function onRequest({ request, env }) {
  const db = env.DB;
  await migrate(db);

  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, '');
  let body = {};
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    try { body = await request.json(); } catch { body = {}; }
  }

  /* ---------- auth ---------- */

  if (path === '/api/auth/register' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'Please enter a valid email address');
    if (password.length < 6) return fail(400, 'Password must be at least 6 characters');
    if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) {
      return fail(409, 'An account with that email already exists');
    }
    const ts = now();
    const { meta } = await db.prepare(
      'INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)'
    ).bind(email, await hashPassword(password), ts).run();
    const user = { id: meta.last_row_id, email };
    // Give every new user a starter notebook.
    await db.prepare('INSERT INTO notebooks (user_id, name, created_at) VALUES (?, ?, ?)')
      .bind(user.id, 'My Notes', ts).run();
    const token = await signToken(user, await getSecret(env));
    return json({ user, token }, 200, { 'Set-Cookie': authCookie(token) });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return fail(401, 'Invalid email or password');
    }
    const token = await signToken(user, await getSecret(env));
    return json({ user: { id: user.id, email: user.email }, token }, 200, { 'Set-Cookie': authCookie(token) });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
  }

  /* ---------- everything below requires auth ---------- */

  const user = await currentUser(request, env);
  if (!user) return fail(401, 'Not authenticated');

  if (path === '/api/auth/me' && method === 'GET') {
    return json({ user: { id: user.id, email: user.email } });
  }

  /* ---------- notebooks ---------- */

  if (path === '/api/notebooks' && method === 'GET') {
    const { results } = await db.prepare(
      `SELECT n.*, (SELECT COUNT(*) FROM pages p WHERE p.notebook_id = n.id) AS page_count
         FROM notebooks n WHERE n.user_id = ? ORDER BY n.created_at ASC`
    ).bind(user.id).all();
    return json(results.map((n) => ({ id: n.id, name: n.name, createdAt: n.created_at, pageCount: n.page_count })));
  }

  if (path === '/api/notebooks' && method === 'POST') {
    const name = String(body.name || '').trim();
    if (!name) return fail(400, 'Notebook name is required');
    const ts = now();
    const { meta } = await db.prepare(
      'INSERT INTO notebooks (user_id, name, created_at) VALUES (?, ?, ?)'
    ).bind(user.id, name, ts).run();
    return json({ id: meta.last_row_id, name, createdAt: ts, pageCount: 0 });
  }

  // All remaining routes are /api/notebooks/:nbId[/...]
  const m = path.match(/^\/api\/notebooks\/(\d+)(?:\/(.*))?$/);
  if (!m) return fail(404, 'Not found');
  const nb = await db.prepare('SELECT * FROM notebooks WHERE id = ? AND user_id = ?')
    .bind(Number(m[1]), user.id).first();
  if (!nb) return fail(404, 'Notebook not found');
  const sub = m[2] || '';

  if (!sub && method === 'PATCH') {
    const name = String(body.name || '').trim();
    if (!name) return fail(400, 'Notebook name is required');
    await db.prepare('UPDATE notebooks SET name = ? WHERE id = ?').bind(name, nb.id).run();
    return json({ id: nb.id, name });
  }

  if (!sub && method === 'DELETE') {
    const { c } = await db.prepare('SELECT COUNT(*) AS c FROM notebooks WHERE user_id = ?').bind(user.id).first();
    if (c <= 1) return fail(400, 'You must keep at least one notebook');
    // D1 doesn't enforce cascading deletes by default, so delete explicitly.
    await db.batch([
      db.prepare('DELETE FROM links WHERE notebook_id = ?').bind(nb.id),
      db.prepare('DELETE FROM pages WHERE notebook_id = ?').bind(nb.id),
      db.prepare('DELETE FROM notebooks WHERE id = ?').bind(nb.id),
    ]);
    return json({ ok: true });
  }

  /* ---------- pages ---------- */

  if (sub === 'pages' && method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    let results;
    if (q) {
      const like = `%${q}%`;
      ({ results } = await db.prepare(
        `SELECT * FROM pages WHERE notebook_id = ?
           AND (title_lower LIKE ? OR lower(content) LIKE ?)
         ORDER BY updated_at DESC LIMIT 100`
      ).bind(nb.id, like, like).all());
    } else {
      ({ results } = await db.prepare(
        'SELECT * FROM pages WHERE notebook_id = ? ORDER BY updated_at DESC LIMIT 200'
      ).bind(nb.id).all());
    }
    return json(await Promise.all(results.map((p) => serializePage(db, p))));
  }

  if (sub === 'titles' && method === 'GET') {
    const { results } = await db.prepare(
      `SELECT title, title_lower AS lower FROM pages WHERE notebook_id = ?
       UNION
       SELECT target_title AS title, target_title_lower AS lower FROM links WHERE notebook_id = ?`
    ).bind(nb.id, nb.id).all();
    const seen = new Map();
    for (const r of results) if (!seen.has(r.lower)) seen.set(r.lower, r.title);
    return json([...seen.values()].sort((a, b) => a.localeCompare(b)));
  }

  if (sub === 'daily' && method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 14, 60);
    const before = String(url.searchParams.get('before') || '');
    const qToday = String(url.searchParams.get('today') || '');
    const today = /^\d{4}-\d{2}-\d{2}$/.test(qToday) ? qToday : new Date().toISOString().slice(0, 10);

    if (!before) {
      const existing = await db.prepare(
        'SELECT id FROM pages WHERE notebook_id = ? AND is_daily = 1 AND daily_date = ?'
      ).bind(nb.id, today).first();
      if (!existing) await createPage(db, nb.id, { title: today, isDaily: true, dailyDate: today });
    }

    const { results } = before
      ? await db.prepare(
          `SELECT * FROM pages WHERE notebook_id = ? AND is_daily = 1 AND daily_date < ?
             AND (content != '' OR daily_date = ?)
           ORDER BY daily_date DESC LIMIT ?`
        ).bind(nb.id, before, today, limit).all()
      : await db.prepare(
          `SELECT * FROM pages WHERE notebook_id = ? AND is_daily = 1
             AND (content != '' OR daily_date = ?)
           ORDER BY daily_date DESC LIMIT ?`
        ).bind(nb.id, today, limit).all();

    return json(await Promise.all(results.map((p) => serializePage(db, p, { withBacklinks: true }))));
  }

  if (sub === 'page' && method === 'GET') {
    const title = String(url.searchParams.get('title') || '').trim();
    if (!title) return fail(400, 'A page title is required');
    let page = await findPageByTitle(db, nb.id, title.toLowerCase());
    if (!page) {
      if (url.searchParams.get('create') === '1') page = await createPage(db, nb.id, { title });
      else return fail(404, 'Page not found');
    }
    return json(await serializePage(db, page, { withBacklinks: true }));
  }

  if (sub === 'pages' && method === 'POST') {
    const title = String(body.title || '').trim();
    if (!title) return fail(400, 'A page title is required');
    const existing = await findPageByTitle(db, nb.id, title.toLowerCase());
    if (existing) return json(await serializePage(db, existing, { withBacklinks: true }));
    const page = await createPage(db, nb.id, { title, content: String(body.content || '') });
    await syncLinks(db, nb.id, page.id, page.content);
    return json(await serializePage(db, await findPageById(db, page.id, nb.id), { withBacklinks: true }));
  }

  const pm = sub.match(/^pages\/(\d+)$/);
  if (pm) {
    const page = await findPageById(db, Number(pm[1]), nb.id);
    if (!page) return fail(404, 'Page not found');

    if (method === 'GET') {
      return json(await serializePage(db, page, { withBacklinks: true }));
    }

    if (method === 'PUT') {
      const content = body.content != null ? String(body.content) : page.content;
      let title = page.title;
      let titleLower = page.title_lower;
      if (!page.is_daily && body.title != null) {
        const newTitle = String(body.title).trim();
        if (!newTitle) return fail(400, 'Title cannot be empty');
        const clash = await findPageByTitle(db, nb.id, newTitle.toLowerCase());
        if (clash && clash.id !== page.id) return fail(409, 'Another page already has that title');
        title = newTitle;
        titleLower = newTitle.toLowerCase();
      }
      await db.prepare(
        'UPDATE pages SET title = ?, title_lower = ?, content = ?, updated_at = ? WHERE id = ?'
      ).bind(title, titleLower, content, now(), page.id).run();
      await syncLinks(db, nb.id, page.id, content);
      return json(await serializePage(db, await findPageById(db, page.id, nb.id), { withBacklinks: true }));
    }

    if (method === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM links WHERE source_page_id = ?').bind(page.id),
        db.prepare('DELETE FROM pages WHERE id = ?').bind(page.id),
      ]);
      return json({ ok: true });
    }
  }

  return fail(404, 'Not found');
}
