import db from './db.js';

// Extract [[wiki links]] from a body of text. Returns an array of unique
// { title, titleLower } objects preserving the first-seen display casing.
export function parseLinks(content) {
  const re = /\[\[([^\[\]]+?)\]\]/g;
  const seen = new Map();
  let m;
  while ((m = re.exec(content)) !== null) {
    const title = m[1].trim();
    if (!title) continue;
    const lower = title.toLowerCase();
    if (!seen.has(lower)) seen.set(lower, title);
  }
  return [...seen.entries()].map(([titleLower, title]) => ({ title, titleLower }));
}

// Rewrite the links table for a single source page. Always scoped to the
// page's own notebook, guaranteeing notebook isolation.
const delLinks = db.prepare('DELETE FROM links WHERE source_page_id = ?');
const insLink = db.prepare(
  `INSERT INTO links (notebook_id, source_page_id, target_title, target_title_lower)
   VALUES (?, ?, ?, ?)`
);

export const syncLinks = db.transaction((notebookId, pageId, content) => {
  delLinks.run(pageId);
  for (const { title, titleLower } of parseLinks(content)) {
    insLink.run(notebookId, pageId, title, titleLower);
  }
});

// Backlinks: every page in the SAME notebook that links to the given title.
// Excludes the page linking to itself.
export function getBacklinks(notebookId, titleLower, selfPageId = null) {
  return db
    .prepare(
      `SELECT DISTINCT p.id, p.title, p.content, p.is_daily, p.daily_date, p.updated_at
         FROM links l
         JOIN pages p ON p.id = l.source_page_id
        WHERE l.notebook_id = ?
          AND l.target_title_lower = ?
          AND p.id != ?
        ORDER BY p.updated_at DESC`
    )
    .all(notebookId, titleLower, selfPageId ?? -1);
}

// Build a snippet of the source content around a reference to `titleLower`,
// so backlinks show context like Reflect's "Linked references".
export function backlinkContext(content, titleLower) {
  const lines = content.split(/\r?\n/);
  const hits = lines.filter((ln) => ln.toLowerCase().includes(`[[${titleLower}]]`));
  return (hits.length ? hits : lines.filter((ln) => ln.trim())).join('\n').trim();
}
