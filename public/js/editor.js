// A WYSIWYG note editor. The rendered note itself becomes editable in place
// (contenteditable), so **bold**, bullets, headings and [[links]] show as
// real formatting *while you type* — like a word processor. On save the DOM is
// serialized back to the same markdown-ish text, so backlinks and storage are
// unchanged.

import { el, renderNoteHtml, debounce } from './util.js';

/* ------------------------------ DOM <-> text ------------------------------ */

function currentBlock(root, node) {
  let n = node;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n && n.nodeType === 1 ? n : null;
}

function caretToStart(node) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// Serialize one inline node tree to markdown.
function inlineToText(node) {
  let out = '';
  for (const c of node.childNodes) {
    if (c.nodeType === 3) { out += c.nodeValue; continue; }
    if (c.nodeType !== 1) continue;
    const tag = c.tagName;
    if (c.classList && c.classList.contains('wikilink')) { out += `[[${c.dataset.link || c.textContent}]]`; continue; }
    if (tag === 'BR') { out += '\n'; continue; }
    if (tag === 'A') { out += c.getAttribute('href') || c.textContent; continue; }
    if (tag === 'STRONG' || tag === 'B') { out += `**${inlineToText(c)}**`; continue; }
    if (tag === 'EM' || tag === 'I') { out += `*${inlineToText(c)}*`; continue; }
    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') { out += `~~${inlineToText(c)}~~`; continue; }
    if (tag === 'CODE') { out += `\`${inlineToText(c)}\``; continue; }
    // span/other: recurse, and honor inline styles execCommand may emit
    let inner = inlineToText(c);
    const st = c.style;
    if (st) {
      if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) inner = `**${inner}**`;
      if (st.fontStyle === 'italic') inner = `*${inner}*`;
      if ((st.textDecorationLine || st.textDecoration || '').includes('line-through')) inner = `~~${inner}~~`;
    }
    out += inner;
  }
  return out;
}

// Serialize the whole editable surface to markdown text.
function serialize(root) {
  const lines = [];
  for (const node of root.childNodes) {
    if (node.nodeType === 3) { if (node.nodeValue.trim()) lines.push(node.nodeValue); continue; }
    if (node.nodeType !== 1) continue;
    const elt = node;
    if (elt.tagName === 'BR') { lines.push(''); continue; }
    let prefix = '';
    const cls = elt.className || '';
    const hTag = /^H([1-6])$/.exec(elt.tagName);
    const hCls = /\bh([1-6])\b/.exec(cls);
    if (hTag) prefix = '#'.repeat(Number(hTag[1])) + ' ';
    else if (cls.includes('h ') && hCls) prefix = '#'.repeat(Number(hCls[1])) + ' ';
    else if (cls.includes('li')) {
      const lvl = Number(elt.style.getPropertyValue('--lvl') || elt.dataset.lvl || 0);
      prefix = '  '.repeat(lvl) + '- ';
    }
    let text = inlineToText(elt).replace(/ /g, ' ').replace(/\n+$/, '');
    lines.push(prefix + text);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

/* ------------------------------ block editing ----------------------------- */

function setBlockType(block, type, lvl = 0) {
  block.removeAttribute('style');
  if (type === 'li') { block.className = 'li'; block.style.setProperty('--lvl', String(lvl)); }
  else if (type === 'h') block.className = 'h h2';
  else block.className = 'ln';
  if (!block.textContent && !block.querySelector('br')) block.innerHTML = '<br>';
}

function handleEnter(root) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const block = currentBlock(root, range.startContainer);
  if (!block) return false;
  const isBullet = block.classList.contains('li');
  const empty = !block.textContent.replace(/​/g, '').trim();

  if (isBullet && empty) { setBlockType(block, 'ln'); caretToStart(block); return true; }

  const tail = range.cloneRange();
  tail.setEndAfter(block.lastChild || block);
  tail.setStart(range.startContainer, range.startOffset);
  const frag = tail.extractContents();

  const nb = document.createElement('div');
  if (isBullet) { nb.className = 'li'; nb.style.setProperty('--lvl', block.style.getPropertyValue('--lvl') || '0'); }
  else nb.className = 'ln';
  nb.appendChild(frag);
  if (!nb.textContent && !nb.querySelector('br')) nb.innerHTML = '<br>';
  if (!block.textContent && !block.querySelector('br')) block.innerHTML = '<br>';
  block.after(nb);
  caretToStart(nb);
  return true;
}

function handleTab(root, shift) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const block = currentBlock(root, sel.getRangeAt(0).startContainer);
  if (!block) return false;
  if (!block.classList.contains('li')) {
    if (shift) return false;
    setBlockType(block, 'li', 0);
    return true;
  }
  let lvl = Number(block.style.getPropertyValue('--lvl') || 0);
  lvl = Math.max(0, Math.min(6, lvl + (shift ? -1 : 1)));
  block.style.setProperty('--lvl', String(lvl));
  return true;
}

function toggleBlock(root, type) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const block = currentBlock(root, sel.getRangeAt(0).startContainer);
  if (!block) return;
  const isType = type === 'li' ? block.classList.contains('li') : /\bh[1-6]\b/.test(block.className);
  const sel2 = window.getSelection();
  const saved = sel2.rangeCount ? sel2.getRangeAt(0).cloneRange() : null;
  setBlockType(block, isType ? 'ln' : type);
  if (saved) { sel2.removeAllRanges(); sel2.addRange(saved); } // keep the caret where it was
}

function wrapCode(root) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const code = document.createElement('code');
  try { range.surroundContents(code); } catch { /* spans multiple nodes */ }
}

/* ------------------------------ autocomplete ------------------------------ */

function makeAutocomplete(root, getTitles) {
  let box = null; let items = []; let active = 0;

  function query() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== 3) return null;
    const before = node.nodeValue.slice(0, range.startOffset);
    const idx = before.lastIndexOf('[[');
    if (idx === -1) return null;
    const between = before.slice(idx + 2);
    if (/[\[\]\n]/.test(between)) return null;
    return { text: between.trim(), node, idx, end: range.startOffset };
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
      const it = el('div', { class: `ac-item ac-create${items.length === 0 ? ' active' : ''}` }, [el('span', { text: `Create “${q.text}”` })]);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); choose(q.text); });
      box.append(it);
      items.push(q.text);
    }
    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    box.style.left = `${rect.left}px`;
    box.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 220)}px`;
    box.style.width = '260px';
  }
  function choose(title) {
    const q = query();
    if (!q) { close(); return; }
    const raw = q.node.nodeValue;
    q.node.nodeValue = raw.slice(0, q.idx); // strip the "[[query"
    const chip = makeChip(title);
    const after = document.createTextNode(' ' + raw.slice(q.end));
    const parent = q.node.parentNode;
    parent.insertBefore(after, q.node.nextSibling);
    parent.insertBefore(chip, after);
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(after, 1);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    close();
  }
  function paint() { if (box) [...box.children].forEach((c, i) => c.classList.toggle('active', i === active)); }
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

function makeChip(title) {
  const a = el('a', { class: 'wikilink', href: '#', 'data-link': title, contenteditable: 'false' });
  a.textContent = title;
  return a;
}

/* -------------------------------- toolbar --------------------------------- */

const TOOLS = [
  { label: 'B', cls: 'tb-b', title: 'Bold  (Ctrl/Cmd+B)', run: () => document.execCommand('bold') },
  { label: 'I', cls: 'tb-i', title: 'Italic  (Ctrl/Cmd+I)', run: () => document.execCommand('italic') },
  { label: 'S', cls: 'tb-s', title: 'Strikethrough', run: () => document.execCommand('strikeThrough') },
  { label: '‹›', cls: 'tb-code', title: 'Inline code', run: (root) => wrapCode(root) },
  { label: 'H', cls: 'tb-h', title: 'Heading', run: (root) => toggleBlock(root, 'h') },
  { label: '•', cls: 'tb-ul', title: 'Bullet list', run: (root) => toggleBlock(root, 'li') },
];

/* ------------------------------ editable note ----------------------------- */

export function editableNote(page, ctx) {
  const opts = { placeholder: ctx.placeholder };
  const wrap = el('div', { class: 'note' });
  const view = el('div', { class: 'note-view', html: renderNoteHtml(page.content, opts) });
  wrap.append(view);
  let editing = false;
  let toolbar = null;
  let ac = null;

  view.addEventListener('mousedown', (e) => {
    if (editing) return;
    const wl = e.target.closest('a.wikilink');
    if (wl) { e.preventDefault(); ctx.openLink(wl.dataset.link); return; }
    if (e.target.closest('a.exturl')) return;
  });
  view.addEventListener('click', () => { if (!editing) enterEdit(); });

  function enterEdit() {
    editing = true;
    if (!page.content.trim()) view.innerHTML = '<div class="ln"><br></div>';
    view.querySelectorAll('a.wikilink').forEach((a) => a.setAttribute('contenteditable', 'false'));
    view.setAttribute('contenteditable', 'true');
    view.classList.add('editing');
    try { document.execCommand('styleWithCSS', false, false); } catch { /* ok */ }

    toolbar = buildToolbar();
    wrap.insertBefore(toolbar, view);
    view.focus();

    ac = makeAutocomplete(view, ctx.getTitles);
    const autosave = debounce(async () => {
      try { const u = await ctx.save(serialize(view)); Object.assign(page, u); ctx.onSaved?.(page); } catch { /* retry on blur */ }
    }, 800);

    view.addEventListener('input', onInput);
    view.addEventListener('keydown', onKeydown);
    view.addEventListener('blur', onBlur);

    function onInput() { ac.refresh(); autosave(); }
    function onKeydown(e) {
      if (ac.handleKey(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && e.shiftKey && (k === 's')) { e.preventDefault(); document.execCommand('strikeThrough'); afterFormat(); return; }
      if (mod && e.shiftKey && (k === 'h')) { e.preventDefault(); toggleBlock(view, 'h'); afterFormat(); return; }
      if (mod && e.shiftKey && e.code === 'Digit8') { e.preventDefault(); toggleBlock(view, 'li'); afterFormat(); return; }
      if (mod && !e.shiftKey && (k === 'b')) { e.preventDefault(); document.execCommand('bold'); afterFormat(); return; }
      if (mod && !e.shiftKey && (k === 'i')) { e.preventDefault(); document.execCommand('italic'); afterFormat(); return; }
      if (mod && !e.shiftKey && (k === 'e')) { e.preventDefault(); wrapCode(view); afterFormat(); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); view.blur(); return; }
      if (e.key === 'Escape') { e.preventDefault(); view.blur(); return; }
      if (e.key === 'Tab') { if (handleTab(view, e.shiftKey)) e.preventDefault(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { if (handleEnter(view)) e.preventDefault(); }
    }
    function afterFormat() { ac.refresh(); autosave(); }

    let committed = false;
    function onBlur() { setTimeout(commit, 150); }
    function commit() {
      if (committed || ac.isOpen()) return;
      committed = true;
      editing = false;
      view.removeEventListener('input', onInput);
      view.removeEventListener('keydown', onKeydown);
      view.removeEventListener('blur', onBlur);
      const content = serialize(view);
      ac.close(); ac = null;
      if (toolbar) { toolbar.remove(); toolbar = null; }
      view.removeAttribute('contenteditable');
      view.classList.remove('editing');
      // Re-render immediately from the serialized text (no flash / no race),
      // then persist in the background and refresh backlinks when it lands.
      page.content = content;
      view.innerHTML = renderNoteHtml(content, opts);
      ctx.save(content).then((u) => { Object.assign(page, u); ctx.onSaved?.(page); }).catch(() => {});
    }
  }

  function buildToolbar() {
    const bar = el('div', { class: 'toolbar' });
    for (const t of TOOLS) {
      const btn = el('button', { class: `tb-btn ${t.cls}`, type: 'button', title: t.title, text: t.label });
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); view.focus(); t.run(view); onToolbarChange(); });
      bar.append(btn);
    }
    return bar;
  }
  function onToolbarChange() {
    if (ac) ac.refresh();
    view.dispatchEvent(new Event('input'));
  }

  if (ctx.autofocus) queueMicrotask(enterEdit);
  return { wrap, edit: enterEdit };
}
