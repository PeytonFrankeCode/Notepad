// Small DOM + text helpers shared across the app.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v != null && v !== false) {
      node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render note text to HTML: escape everything, turn [[wiki links]] into
// clickable anchors, linkify bare URLs, keep bullet lines and line breaks.
export function renderNoteHtml(text) {
  if (!text || !text.trim()) {
    return '<span class="placeholder">Empty — click to write…</span>';
  }
  const lines = text.split(/\r?\n/);
  const html = lines
    .map((line) => {
      let safe = escapeHtml(line);
      // [[wiki links]]
      safe = safe.replace(/\[\[([^\[\]]+?)\]\]/g, (_, t) => {
        const title = t.trim();
        return `<a class="wikilink" data-link="${escapeHtml(title)}" href="#">${escapeHtml(title)}</a>`;
      });
      // bare URLs
      safe = safe.replace(
        /(^|\s)(https?:\/\/[^\s<]+)/g,
        (_, pre, url) => `${pre}<a class="exturl" href="${url}" target="_blank" rel="noopener">${url}</a>`
      );
      // simple bullets
      const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
      if (bullet) return `<div class="bullet">${safe.replace(/^(\s*)[-*]\s+/, '$1• ')}</div>`;
      if (!line.trim()) return '<div class="blank">&nbsp;</div>';
      return `<div class="ln">${safe}</div>`;
    })
    .join('');
  return html;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Format a YYYY-MM-DD string into { dayNum, weekday, monthYear, isToday }.
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

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
