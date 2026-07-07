// An editable note: shows rendered markdown; on click becomes a textarea with
// a formatting toolbar, keyboard shortcuts, smart lists, and [[ autocomplete.

import { el, renderNoteHtml, debounce } from './util.js';

function fireInput(ta) { ta.dispatchEvent(new Event('input')); }
function autoresize(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.max(ta.scrollHeight, 42)}px`; }

function lineBounds(v, pos) {
  const start = v.lastIndexOf('\n', pos - 1) + 1;
  let end = v.indexOf('\n', pos);
  if (end === -1) end = v.length;
  return { start, end };
}

function wrapSelection(ta, before, after = before) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const sel = v.slice(s, e) || 'text';
  ta.value = v.slice(0, s) + before + sel + after + v.slice(e);
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  fireInput(ta);
}

function toggleLinePrefix(ta, prefix) {
  const pos = ta.selectionStart;
  const v = ta.value;
  const { start } = lineBounds(v, pos);
  const line = v.slice(start);
  if (line.startsWith(prefix)) {
    ta.value = v.slice(0, start) + line.slice(prefix.length);
    ta.setSelectionRange(Math.max(start, pos - prefix.length), Math.max(start, pos - prefix.length));
  } else {
    ta.value = v.slice(0, start) + prefix + v.slice(start);
    ta.setSelectionRange(pos + prefix.length, pos + prefix.length);
  }
  fireInput(ta);
}

function indent(ta, remove) {
  const pos = ta.selectionStart;
  const v = ta.value;
  const { start } = lineBounds(v, pos);
  if (remove) {
    const line = v.slice(start);
    const rm = line.startsWith('  ') ? 2 : (/^[ \t]/.test(line) ? 1 : 0);
    if (!rm) return;
    ta.value = v.slice(0, start) + line.slice(rm);
    ta.setSelectionRange(Math.max(start, pos - rm), Math.max(start, pos - rm));
  } else {
    ta.value = v.slice(0, start) + '  ' + v.slice(start);
    ta.setSelectionRange(pos + 2, pos + 2);
  }
  fireInput(ta);
}

// Enter inside a bullet: continue the list; on an empty bullet, end it.
function handleListEnter(ta) {
  const pos = ta.selectionStart;
  if (pos !== ta.selectionEnd) return false;
  const v = ta.value;
  const { start, end } = lineBounds(v, pos);
  const m = /^(\s*)([-*])\s+(.*)$/.exec(v.slice(start, end));
  if (!m) return false;
  if (!m[3].trim()) {
    ta.value = v.slice(0, start) + v.slice(end);
    ta.setSelectionRange(start, start);
    fireInput(ta);
    return true;
  }
  const insert = `\n${m[1]}- `;
  ta.value = v.slice(0, pos) + insert + v.slice(pos);
  ta.setSelectionRange(pos + insert.length, pos + insert.length);
  fireInput(ta);
  return true;
}

/* ------------------------------ autocomplete ------------------------------ */

function makeAutocomplete(ta, getTitles) {
  let box = null;
  let items = [];
  let active = 0;

  function query() {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const open = before.lastIndexOf('[[');
    if (open === -1) return null;
    const between = before.slice(open + 2);
    if (/[\[\]\n]/.test(between)) return null;
    return { text: between.trim(), start: open + 2, end: pos };
  }

  function close() { if (box) { box.remove(); box = null; } items = []; }

  function show(q) {
    const lower = q.text.toLowerCase();
    const titles = getTitles();
    items = titles.filter((t) => t.toLowerCase().includes(lower)).slice(0, 8);
    const canCreate = q.text && !titles.some((t) => t.toLowerCase() === lower);
    if (!items.length && !canCreate) { close(); return; }
    active = 0;
    if (!box) { box = el('div', { class: 'ac-box' }); document.body.append(box); }
    box.innerHTML = '';
    items.forEach((t, i) => {
      const it = el('div', { class: `ac-item${i === active ? ' active' : ''}` }, [el('span', { text: t })]);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); choose(t); });
      box.append(it);
    });
    if (canCreate) {
      const it = el('div', { class: `ac-item ac-create${items.length === 0 ? ' active' : ''}` },
        [el('span', { text: `Create “${q.text}”` })]);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); choose(q.text); });
      box.append(it);
      items.push(q.text);
    }
    const r = ta.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${Math.min(r.bottom + 2, window.innerHeight - 220)}px`;
    box.style.width = `${Math.min(Math.max(r.width, 200), 340)}px`;
  }

  function choose(title) {
    const q = query();
    if (!q) { close(); return; }
    const before = ta.value.slice(0, q.start);
    const after = ta.value.slice(q.end);
    const hasClose = after.startsWith(']]');
    ta.value = before + title + (hasClose ? '' : ']]') + after;
    const caret = before.length + title.length + 2;
    ta.setSelectionRange(caret, caret);
    close();
    ta.focus();
    fireInput(ta);
  }

  function paint() {
    if (box) [...box.children].forEach((c, i) => c.classList.toggle('active', i === active));
  }

  return {
    refresh() { const q = query(); q ? show(q) : close(); },
    isOpen: () => !!box,
    close,
    handleKey(e) {
      if (!box) return false;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; paint(); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(items[active]); return true; }
      if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
      return false;
    },
  };
}

/* -------------------------------- toolbar --------------------------------- */

const TOOLS = [
  { label: 'B', title: 'Bold  (Ctrl/Cmd+B)', cls: 'tb-b', run: (ta) => wrapSelection(ta, '**') },
  { label: 'I', title: 'Italic  (Ctrl/Cmd+I)', cls: 'tb-i', run: (ta) => wrapSelection(ta, '*') },
  { label: 'S', title: 'Strikethrough', cls: 'tb-s', run: (ta) => wrapSelection(ta, '~~') },
  { label: '‹›', title: 'Inline code', cls: 'tb-code', run: (ta) => wrapSelection(ta, '`') },
  { label: 'H', title: 'Heading', cls: 'tb-h', run: (ta) => toggleLinePrefix(ta, '# ') },
  { label: '•', title: 'Bullet list', cls: 'tb-ul', run: (ta) => toggleLinePrefix(ta, '- ') },
  { label: '[[]]', title: 'Link to a page', cls: 'tb-link', run: (ta, ac) => { wrapSelection(ta, '[[', ']]'); ac.refresh(); } },
];

function buildToolbar(ta, ac) {
  const bar = el('div', { class: 'toolbar' });
  for (const t of TOOLS) {
    const btn = el('button', { class: `tb-btn ${t.cls}`, type: 'button', title: t.title, text: t.label });
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); ta.focus(); t.run(ta, ac); });
    bar.append(btn);
  }
  return bar;
}

/* ------------------------------ editable note ----------------------------- */

export function editableNote(page, ctx) {
  const opts = { placeholder: ctx.placeholder };
  const wrap = el('div', { class: 'note' });
  const view = el('div', { class: 'note-view', html: renderNoteHtml(page.content, opts) });
  wrap.append(view);
  let editing = false;

  view.addEventListener('click', (e) => {
    const wl = e.target.closest('a.wikilink');
    if (wl) { e.preventDefault(); ctx.openLink(wl.dataset.link); return; }
    if (e.target.closest('a.exturl')) return;
    enterEdit();
  });

  function enterEdit() {
    if (editing) return;
    editing = true;

    const ta = el('textarea', { class: 'note-edit', spellcheck: 'true' });
    ta.value = page.content;
    const ac = makeAutocomplete(ta, ctx.getTitles);
    const root = el('div', { class: 'note-editing' }, [buildToolbar(ta, ac), ta]);
    wrap.replaceChild(root, view);
    autoresize(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const autosave = debounce(async () => {
      try { const u = await ctx.save(ta.value); Object.assign(page, u); ctx.onSaved?.(page); } catch { /* retry on blur */ }
    }, 700);

    ta.addEventListener('input', () => { autoresize(ta); ac.refresh(); autosave(); });
    ta.addEventListener('click', () => ac.refresh());
    ta.addEventListener('keydown', (e) => {
      if (ac.handleKey(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); wrapSelection(ta, '**'); return; }
      if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); wrapSelection(ta, '*'); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); ta.blur(); return; }
      if (e.key === 'Escape') { e.preventDefault(); ta.blur(); return; }
      if (e.key === 'Tab') { e.preventDefault(); indent(ta, e.shiftKey); return; }
      if (e.key === 'Enter' && !e.shiftKey && handleListEnter(ta)) { e.preventDefault(); }
    });

    let committed = false;
    ta.addEventListener('blur', () => setTimeout(commit, 120));
    async function commit() {
      if (committed || ac.isOpen()) return;
      committed = true;
      editing = false;
      const content = ta.value;
      try { const u = await ctx.save(content); Object.assign(page, u); }
      catch { page.content = content; }
      view.innerHTML = renderNoteHtml(page.content, opts);
      if (root.parentNode === wrap) wrap.replaceChild(view, root);
      ctx.onSaved?.(page);
    }
  }

  if (ctx.autofocus) enterEdit();
  return { wrap, edit: enterEdit };
}
