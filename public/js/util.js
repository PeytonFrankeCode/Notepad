// DOM helpers, date formatting, and the note renderer (markdown-lite +
// [[wiki links]] + nested bullets).

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* --------------------------- inline + block render ------------------------ */

// Inline markdown: **bold**, *italic*, ~~strike~~, `code`, [[links]], URLs.
// The text is escaped first, then split on `code spans` so markdown inside
// code is left alone — no sentinels required.
function inline(raw) {
  return escapeHtml(raw)
    .split(/(`[^`]+`)/g)
    .map((part) => {
      if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${part.slice(1, -1)}</code>`;
      }
      return fmt(part);
    })
    .join('');
}

// Format one already-escaped, code-free text segment.
function fmt(s) {
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])_(?!\s)([^_\n]+?)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+?)~~/g, '<del>$1</del>');
  // [[wiki links]] — `t` is already HTML-escaped; the browser decodes the
  // attribute value back to the real title for the click handler.
  s = s.replace(/\[\[([^\[\]]+?)\]\]/g,
    (_, t) => `<a class="wikilink" data-link="${t.trim()}" href="#">${t.trim()}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_, pre, url) => `${pre}<a class="exturl" href="${url}" target="_blank" rel="noopener">${url}</a>`);
  return s;
}

// Leading-whitespace nesting level for a bullet line (2 spaces / tab = 1 level).
export function bulletLevel(line) {
  const lead = (line.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '  ');
  return Math.floor(lead.length / 2);
}

// Render note text to HTML. "- "/"* " lines become indented bullet rows
// (nesting by leading whitespace); "# " lines become headings.
export function renderNoteHtml(text, { placeholder = 'Empty — click to write…' } = {}) {
  if (!text || !text.trim()) return `<div class="placeholder">${escapeHtml(placeholder)}</div>`;
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) { out.push('<div class="blank"></div>'); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) { out.push(`<div class="h h${h[1].length}">${inline(h[2])}</div>`); continue; }
    const b = /^([ \t]*)[-*]\s+(.*)$/.exec(raw);
    if (b) {
      const lvl = Math.floor(b[1].replace(/\t/g, '  ').length / 2);
      out.push(`<div class="li" style="--lvl:${lvl}">${inline(b[2])}</div>`);
      continue;
    }
    out.push(`<div class="ln">${inline(raw)}</div>`);
  }
  return out.join('');
}

/* --------------------------------- dates ---------------------------------- */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    dayNum: String(d).padStart(2, '0'),
    weekday: DAYS[dt.getUTCDay()],
    monthYear: `${MONTHS[m - 1]} ${y}`,
    full: `${DAYS[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`,
    isToday: iso === todayISO(),
  };
}
