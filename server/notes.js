// Link parsing + backlink logic, shared by the Node routes. Mirrors the
// Cloudflare Functions implementation so both deployments behave identically.

import db from './db.js';

export function parseLinks(content) {
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

// A backlink's context: the line mentioning [[title]] PLUS every line nested
// beneath it (more deeply indented) — so bulleted detail comes along.
export function backlinkContext(content, titleLower) {
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

export function getBacklinks(notebookId, titleLower, selfPageId = -1) {
  return db
    .prepare(
      `SELECT DISTINCT p.id, p.title, p.content, p.is_daily, p.daily_date, p.updated_at
         FROM links l JOIN pages p ON p.id = l.source_page_id
        WHERE l.notebook_id = ? AND l.target_title_lower = ? AND p.id != ?
        ORDER BY p.updated_at DESC`
    )
    .all(notebookId, titleLower, selfPageId);
}
