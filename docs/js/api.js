// Local, in-browser data layer. Same surface as the old server API, but all
// notes live in localStorage — nothing ever leaves this browser.

const KEY = 'notepad.data.v1';

const now = () => new Date().toISOString();
const todayISO = () => new Date().toISOString().slice(0, 10);

/* --------------------------------- storage -------------------------------- */

let data;
data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.notebooks) && Array.isArray(d.pages) && Array.isArray(d.links)) {
        return d;
      }
    }
  } catch { /* corrupted — reseed */ }
  return seed();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    throw new Error('Could not save — this browser’s storage is full or blocked.');
  }
}

function seed() {
  const d = { nextId: 1, notebooks: [], pages: [], links: [] };
  const ts = now();
  const nb = { id: d.nextId++, name: 'My Notes', createdAt: ts };
  d.notebooks.push(nb);

  const guide = {
    id: d.nextId++, notebookId: nb.id,
    title: 'Getting started', titleLower: 'getting started',
    content: [
      'Welcome to Notepad! A few things to try:',
      '- Write in today’s card on the Daily Notes feed — it saves as you type.',
      '- Type [[ anywhere to link to a page (it autocompletes, and creates pages that don’t exist yet).',
      '- Open a page to see its linked references — every note that mentions it.',
      '- Use the notebook menu to create separate notebooks; each keeps its own pages and links.',
      '',
      'Your notes are stored privately in this browser. Use Export in the sidebar to back them up or move them to another device.',
    ].join('\n'),
    isDaily: false, dailyDate: null, createdAt: ts, updatedAt: ts,
  };
  d.pages.push(guide);

  const today = todayISO();
  d.pages.push({
    id: d.nextId++, notebookId: nb.id,
    title: today, titleLower: today,
    content: 'Welcome! This is today’s note. New to Notepad? See [[Getting started]].',
    isDaily: true, dailyDate: today, createdAt: ts, updatedAt: ts,
  });

  data = d;
  for (const p of d.pages) syncLinks(p);
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode */ }
  return d;
}

/* --------------------------------- helpers -------------------------------- */

function notebook(id) {
  const nb = data.notebooks.find((n) => n.id === Number(id));
  if (!nb) throw new Error('Notebook not found');
  return nb;
}

function pageById(nbId, id) {
  return data.pages.find((p) => p.notebookId === Number(nbId) && p.id === Number(id));
}

function pageByTitle(nbId, titleLower) {
  return data.pages.find((p) => p.notebookId === Number(nbId) && p.titleLower === titleLower);
}

function makePage(notebookId, { title, isDaily = false, dailyDate = null, content = '' }) {
  const ts = now();
  const page = {
    id: data.nextId++, notebookId,
    title, titleLower: title.toLowerCase(),
    content, isDaily, dailyDate,
    createdAt: ts, updatedAt: ts,
  };
  data.pages.push(page);
  return page;
}

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

// Rewrite the links for a source page, scoped to its own notebook.
function syncLinks(page) {
  data.links = data.links.filter((l) => l.sourcePageId !== page.id);
  for (const { title, titleLower } of parseLinks(page.content)) {
    data.links.push({
      notebookId: page.notebookId,
      sourcePageId: page.id,
      targetTitle: title,
      targetTitleLower: titleLower,
    });
  }
}

// Every page in the same notebook that links to `titleLower` (except itself).
function getBacklinks(notebookId, titleLower, selfPageId) {
  const sources = new Set(
    data.links
      .filter((l) => l.notebookId === notebookId && l.targetTitleLower === titleLower)
      .map((l) => l.sourcePageId)
  );
  return data.pages
    .filter((p) => sources.has(p.id) && p.id !== selfPageId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Snippet of the source content around a reference, for "Linked references".
function backlinkContext(content, titleLower) {
  const lines = content.split(/\r?\n/);
  const hits = lines.filter((ln) => ln.toLowerCase().includes(`[[${titleLower}]]`));
  return (hits.length ? hits : lines.filter((ln) => ln.trim())).join('\n').trim();
}

function serializePage(page, { withBacklinks = false } = {}) {
  const out = {
    id: page.id,
    notebookId: page.notebookId,
    title: page.title,
    content: page.content,
    isDaily: page.isDaily,
    dailyDate: page.dailyDate,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
  if (withBacklinks) {
    out.backlinks = getBacklinks(page.notebookId, page.titleLower, page.id).map((b) => ({
      id: b.id,
      title: b.title,
      isDaily: b.isDaily,
      dailyDate: b.dailyDate,
      updatedAt: b.updatedAt,
      context: backlinkContext(b.content, page.titleLower),
    }));
  }
  return out;
}

/* ----------------------------------- api ----------------------------------- */

export const api = {
  // notebooks
  listNotebooks() {
    return data.notebooks
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((n) => ({
        id: n.id,
        name: n.name,
        createdAt: n.createdAt,
        pageCount: data.pages.filter((p) => p.notebookId === n.id).length,
      }));
  },

  createNotebook(name) {
    name = String(name || '').trim();
    if (!name) throw new Error('Notebook name is required');
    const nb = { id: data.nextId++, name, createdAt: now() };
    data.notebooks.push(nb);
    save();
    return { id: nb.id, name: nb.name, createdAt: nb.createdAt, pageCount: 0 };
  },

  renameNotebook(id, name) {
    const nb = notebook(id);
    name = String(name || '').trim();
    if (!name) throw new Error('Notebook name is required');
    nb.name = name;
    save();
    return { id: nb.id, name };
  },

  deleteNotebook(id) {
    const nb = notebook(id);
    if (data.notebooks.length <= 1) throw new Error('You must keep at least one notebook');
    data.notebooks = data.notebooks.filter((n) => n.id !== nb.id);
    data.pages = data.pages.filter((p) => p.notebookId !== nb.id);
    data.links = data.links.filter((l) => l.notebookId !== nb.id);
    save();
    return { ok: true };
  },

  // pages
  listPages(nbId, search) {
    const nb = notebook(nbId);
    const q = String(search || '').trim().toLowerCase();
    let rows = data.pages.filter((p) => p.notebookId === nb.id);
    if (q) {
      rows = rows.filter(
        (p) => p.titleLower.includes(q) || p.content.toLowerCase().includes(q)
      );
    }
    return rows
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, q ? 100 : 200)
      .map((p) => serializePage(p));
  },

  // Existing pages *and* any title referenced anywhere in this notebook.
  listTitles(nbId) {
    const nb = notebook(nbId);
    const seen = new Map();
    for (const p of data.pages) {
      if (p.notebookId === nb.id && !seen.has(p.titleLower)) seen.set(p.titleLower, p.title);
    }
    for (const l of data.links) {
      if (l.notebookId === nb.id && !seen.has(l.targetTitleLower)) {
        seen.set(l.targetTitleLower, l.targetTitle);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  },

  // Daily feed: today (auto-created) + past days that have content.
  dailyFeed(nbId, opts = {}) {
    const nb = notebook(nbId);
    const limit = Math.min(Number(opts.limit) || 14, 60);
    const before = String(opts.before || '');
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.today || '')) ? opts.today : todayISO();

    if (!before && !pageByTitle(nb.id, today)) {
      makePage(nb.id, { title: today, isDaily: true, dailyDate: today });
      save();
    }

    return data.pages
      .filter(
        (p) =>
          p.notebookId === nb.id &&
          p.isDaily &&
          (!before || p.dailyDate < before) &&
          (p.content !== '' || p.dailyDate === today)
      )
      .sort((a, b) => b.dailyDate.localeCompare(a.dailyDate))
      .slice(0, limit)
      .map((p) => serializePage(p, { withBacklinks: true }));
  },

  getPageByTitle(nbId, title, create = true) {
    const nb = notebook(nbId);
    title = String(title || '').trim();
    if (!title) throw new Error('A page title is required');
    let page = pageByTitle(nb.id, title.toLowerCase());
    if (!page) {
      if (!create) throw new Error('Page not found');
      page = makePage(nb.id, { title });
      save();
    }
    return serializePage(page, { withBacklinks: true });
  },

  getPage(nbId, id) {
    const page = pageById(notebook(nbId).id, id);
    if (!page) throw new Error('Page not found');
    return serializePage(page, { withBacklinks: true });
  },

  createPage(nbId, title, content = '') {
    const nb = notebook(nbId);
    title = String(title || '').trim();
    if (!title) throw new Error('A page title is required');
    const existing = pageByTitle(nb.id, title.toLowerCase());
    if (existing) return serializePage(existing, { withBacklinks: true });
    const page = makePage(nb.id, { title, content: String(content) });
    syncLinks(page);
    save();
    return serializePage(page, { withBacklinks: true });
  },

  updatePage(nbId, id, patch = {}) {
    const nb = notebook(nbId);
    const page = pageById(nb.id, id);
    if (!page) throw new Error('Page not found');

    if (!page.isDaily && patch.title != null) {
      const newTitle = String(patch.title).trim();
      if (!newTitle) throw new Error('Title cannot be empty');
      const clash = pageByTitle(nb.id, newTitle.toLowerCase());
      if (clash && clash.id !== page.id) throw new Error('Another page already has that title');
      page.title = newTitle;
      page.titleLower = newTitle.toLowerCase();
    }
    if (patch.content != null) page.content = String(patch.content);
    page.updatedAt = now();
    syncLinks(page);
    save();
    return serializePage(page, { withBacklinks: true });
  },

  deletePage(nbId, id) {
    const nb = notebook(nbId);
    const page = pageById(nb.id, id);
    if (!page) throw new Error('Page not found');
    data.pages = data.pages.filter((p) => p.id !== page.id);
    data.links = data.links.filter((l) => l.sourcePageId !== page.id);
    save();
    return { ok: true };
  },

  // backup
  exportData() {
    return JSON.stringify({ app: 'notepad', version: 1, exportedAt: now(), data }, null, 2);
  },

  importData(json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('That file isn’t valid JSON.');
    }
    const d = parsed?.data ?? parsed;
    if (!d || !Array.isArray(d.notebooks) || !Array.isArray(d.pages) || !Array.isArray(d.links) || !d.notebooks.length) {
      throw new Error('That file doesn’t look like a Notepad export.');
    }
    data = d;
    save();
  },
};
