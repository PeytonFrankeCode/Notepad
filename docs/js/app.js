import { api } from './api.js';
import { el, renderNoteHtml, formatDate, todayISO, debounce } from './util.js';

const root = document.getElementById('root');

const state = {
  notebooks: [],
  notebookId: null,
  view: 'daily', // 'daily' | 'page'
  page: null, // focused page object (page view)
  pageTitles: [], // titles in current notebook, for [[ autocomplete
};

const LS_NB = 'notepad.notebookId';

/* --------------------------------- boot ----------------------------------- */

loadWorkspace();

async function loadWorkspace() {
  state.notebooks = await api.listNotebooks();
  const saved = Number(localStorage.getItem(LS_NB));
  state.notebookId = state.notebooks.some((n) => n.id === saved)
    ? saved
    : state.notebooks[0]?.id;
  await refreshPageTitles();
  state.view = 'daily';
  renderApp();
}

async function refreshPageTitles() {
  try {
    state.pageTitles = await api.listTitles(state.notebookId);
  } catch {
    state.pageTitles = [];
  }
}

/* ------------------------------- app shell -------------------------------- */

function renderApp() {
  root.innerHTML = '';
  const shell = el('div', { class: 'app' });
  shell.append(renderSidebar(), el('main', { class: 'main', id: 'main' }));
  root.append(shell);
  renderMain();
}

function navigate(view) {
  state.view = view;
  if (view === 'daily') state.page = null;
  renderApp();
}

function renderMain() {
  const main = document.getElementById('main');
  main.innerHTML = '<div class="loading">Loading…</div>';
  if (state.view === 'daily') renderDaily(main);
  else renderPage(main);
}

/* -------------------------------- sidebar --------------------------------- */

function renderSidebar() {
  const side = el('aside', { class: 'sidebar' });

  side.append(el('div', { class: 'brand' }, [el('span', { class: 'logo', text: '📓' }), el('span', { text: 'Notepad' })]));

  // Notebook selector
  const select = el('select', { class: 'nb-select', onChange: (e) => switchNotebook(Number(e.target.value)) });
  for (const n of state.notebooks) {
    select.append(el('option', { value: n.id, selected: n.id === state.notebookId }, `${n.name} (${n.pageCount})`));
  }
  const nbRow = el('div', { class: 'nb-row' }, [
    select,
    el('button', { class: 'icon-btn', title: 'New notebook', onClick: newNotebook }, '＋'),
    el('button', { class: 'icon-btn', title: 'Notebook options', onClick: (e) => openNotebookMenu(e) }, '⋯'),
  ]);
  side.append(el('div', { class: 'side-section' }, [el('label', { class: 'side-label', text: 'Notebook' }), nbRow]));

  // Nav
  side.append(el('button', { class: 'nav-item' + (state.view === 'daily' ? ' active' : ''), onClick: () => navigate('daily') },
    [el('span', { class: 'nav-ic', text: '🗓️' }), 'Daily Notes']));
  side.append(el('button', { class: 'nav-item', onClick: newPage }, [el('span', { class: 'nav-ic', text: '➕' }), 'New page']));

  // Pages / search
  const search = el('input', { class: 'search', type: 'search', placeholder: 'Search this notebook…' });
  const results = el('div', { class: 'page-list' });
  const doSearch = debounce(async () => {
    const pages = await api.listPages(state.notebookId, search.value.trim());
    renderPageList(results, pages);
  }, 180);
  search.addEventListener('input', doSearch);
  side.append(el('div', { class: 'side-section grow' }, [el('label', { class: 'side-label', text: 'Pages' }), search, results]));
  renderPageList(results, api.listPages(state.notebookId));

  // Local data footer: everything lives in this browser.
  side.append(el('div', { class: 'user-row' }, [
    el('span', { class: 'user-email', title: 'Notes are stored privately in this browser', text: '🔒 Saved in this browser' }),
    el('button', { class: 'link-btn', onClick: exportNotes }, 'Export'),
    el('button', { class: 'link-btn', onClick: importNotes }, 'Import'),
  ]));

  return side;
}

function renderPageList(container, pages) {
  container.innerHTML = '';
  if (!pages.length) {
    container.append(el('div', { class: 'empty-hint', text: 'No pages yet.' }));
    return;
  }
  for (const p of pages) {
    const label = p.isDaily ? formatDate(p.dailyDate).full : p.title;
    container.append(el('button', {
      class: 'page-link',
      onClick: () => openPageById(p.id),
    }, [el('span', { class: 'page-ic', text: p.isDaily ? '🗓️' : '📄' }), el('span', { class: 'page-name', text: label })]));
  }
}

async function switchNotebook(id) {
  state.notebookId = id;
  localStorage.setItem(LS_NB, String(id));
  state.view = 'daily';
  state.page = null;
  await refreshPageTitles();
  renderApp();
}

async function newNotebook() {
  const name = prompt('Name your new notebook:', 'New notebook');
  if (!name || !name.trim()) return;
  try {
    const nb = await api.createNotebook(name.trim());
    state.notebooks.push(nb);
    await switchNotebook(nb.id);
  } catch (e) { alert(e.message); }
}

function openNotebookMenu(e) {
  closeMenus();
  const nb = state.notebooks.find((n) => n.id === state.notebookId);
  const menu = el('div', { class: 'menu' }, [
    el('button', { class: 'menu-item', onClick: async () => {
      closeMenus();
      const name = prompt('Rename notebook:', nb.name);
      if (!name || !name.trim()) return;
      await api.renameNotebook(nb.id, name.trim());
      nb.name = name.trim();
      renderApp();
    } }, 'Rename notebook'),
    el('button', { class: 'menu-item danger', onClick: async () => {
      closeMenus();
      if (!confirm(`Delete “${nb.name}” and all of its notes? This cannot be undone.`)) return;
      try {
        await api.deleteNotebook(nb.id);
        state.notebooks = state.notebooks.filter((n) => n.id !== nb.id);
        await switchNotebook(state.notebooks[0].id);
      } catch (ex) { alert(ex.message); }
    } }, 'Delete notebook'),
  ]);
  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
}

function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
}

async function newPage() {
  const title = prompt('Title for the new page:');
  if (!title || !title.trim()) return;
  try {
    const page = await api.createPage(state.notebookId, title.trim());
    await refreshPageTitles();
    openPage(page);
  } catch (e) { alert(e.message); }
}

/* ----------------------------- export / import ---------------------------- */

function exportNotes() {
  const blob = new Blob([api.exportData()], { type: 'application/json' });
  const a = el('a', {
    href: URL.createObjectURL(blob),
    download: `notepad-export-${todayISO()}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function importNotes() {
  const input = el('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (!confirm('Importing replaces all notes currently in this browser. Continue?')) return;
    try {
      api.importData(await file.text());
      await loadWorkspace();
    } catch (e) { alert(e.message); }
  });
  input.click();
}

/* --------------------------- navigation to pages -------------------------- */

function openPage(page) {
  state.page = page;
  state.view = 'page';
  renderApp();
}

async function openPageById(id) {
  try {
    const page = await api.getPage(state.notebookId, id);
    openPage(page);
  } catch (e) { alert(e.message); }
}

async function openPageByTitle(title) {
  try {
    const page = await api.getPageByTitle(state.notebookId, title, true);
    await refreshPageTitles();
    openPage(page);
  } catch (e) { alert(e.message); }
}

/* ------------------------------- daily view ------------------------------- */

async function renderDaily(main) {
  let feed;
  try {
    feed = await api.dailyFeed(state.notebookId, { today: todayISO() });
  } catch (e) {
    main.innerHTML = `<div class="error">${e.message}</div>`;
    return;
  }
  main.innerHTML = '';
  main.append(el('div', { class: 'view-head' }, [el('h1', { text: 'Daily Notes' })]));

  const list = el('div', { class: 'daily-list' });
  for (const page of feed) list.append(dailyCard(page));
  main.append(list);

  if (feed.length) {
    main.append(makeLoadMore(list, feed[feed.length - 1].dailyDate));
  }
}

function makeLoadMore(list, oldest) {
  const btn = el('button', { class: 'load-more' }, 'Load earlier days');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const more = await api.dailyFeed(state.notebookId, { before: oldest, today: todayISO() });
    if (!more.length) { btn.textContent = 'No earlier days'; return; }
    for (const p of more) list.append(dailyCard(p));
    btn.replaceWith(makeLoadMore(list, more[more.length - 1].dailyDate));
  });
  return btn;
}

function dailyCard(page) {
  const f = formatDate(page.dailyDate);
  const card = el('div', { class: 'day-card' + (f.isToday ? ' today' : '') });

  const head = el('div', { class: 'day-head' }, [
    el('div', { class: 'day-num', text: f.dayNum }),
    el('div', { class: 'day-meta' }, [
      el('div', { class: 'day-weekday' }, [f.weekday, f.isToday ? el('span', { class: 'today-badge', text: 'Today' }) : null]),
      el('div', { class: 'day-monthyear', text: f.monthYear }),
    ]),
  ]);

  const blWrap = el('div', { class: 'backlinks' });
  const note = editableNote({
    page,
    onSaved: () => { renderBacklinks(blWrap, page); refreshPageTitles(); },
  });
  renderBacklinks(blWrap, page);

  card.append(head, note.wrap, blWrap);
  return card;
}

/* -------------------------------- page view ------------------------------- */

async function renderPage(main) {
  const page = state.page;
  main.innerHTML = '';

  main.append(el('div', { class: 'view-head' }, [
    el('button', { class: 'back-btn', onClick: () => navigate('daily') }, '← Daily Notes'),
    !page.isDaily ? el('button', { class: 'del-btn', onClick: () => deleteCurrentPage() }, 'Delete page') : null,
  ]));

  const titleText = page.isDaily ? formatDate(page.dailyDate).full : page.title;
  const title = el('input', { class: 'page-title', value: titleText });
  if (page.isDaily) {
    title.setAttribute('readonly', '');
  } else {
    title.addEventListener('change', async () => {
      const v = title.value.trim();
      if (!v || v === page.title) { title.value = page.title; return; }
      try {
        const u = await api.updatePage(state.notebookId, page.id, { title: v });
        Object.assign(page, u);
        await refreshPageTitles();
      } catch (e) { alert(e.message); title.value = page.title; }
    });
  }

  const blWrap = el('div', { class: 'backlinks' });
  const note = editableNote({
    page,
    onSaved: () => { renderBacklinks(blWrap, page); refreshPageTitles(); },
  });
  renderBacklinks(blWrap, page);

  main.append(el('div', { class: 'page-body' }, [title, note.wrap, el('div', { class: 'bl-sep' }), blWrap]));
}

async function deleteCurrentPage() {
  const page = state.page;
  if (!confirm(`Delete “${page.title}”?`)) return;
  await api.deletePage(state.notebookId, page.id);
  await refreshPageTitles();
  navigate('daily');
}

/* ------------------------------- backlinks -------------------------------- */

function renderBacklinks(wrap, page) {
  wrap.innerHTML = '';
  const bls = page.backlinks || [];
  if (!bls.length) return;
  wrap.append(el('div', { class: 'bl-head', text: `${bls.length} linked reference${bls.length > 1 ? 's' : ''}` }));
  for (const b of bls) {
    const label = b.isDaily ? formatDate(b.dailyDate).full : b.title;
    const item = el('div', { class: 'bl-item' });
    const titleLink = el('a', { class: 'bl-title', href: '#',
      onClick: (e) => { e.preventDefault(); b.isDaily ? openPageByTitle(b.title) : openPageById(b.id); } }, label);
    const ctx = el('div', { class: 'bl-context', html: renderNoteHtml(b.context || '') });
    ctx.addEventListener('click', (e) => {
      const l = e.target.closest('a.wikilink');
      if (l) { e.preventDefault(); openPageByTitle(l.dataset.link); }
    });
    item.append(titleLink, ctx);
    wrap.append(item);
  }
}

/* --------------------------- editable note widget ------------------------- */

function autoresize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.max(ta.scrollHeight, 48)}px`;
}

function editableNote({ page, onSaved }) {
  const wrap = el('div', { class: 'note' });
  const view = el('div', { class: 'note-view', html: renderNoteHtml(page.content) });
  wrap.append(view);
  let editing = false;

  view.addEventListener('click', (e) => {
    const wl = e.target.closest('a.wikilink');
    if (wl) { e.preventDefault(); openPageByTitle(wl.dataset.link); return; }
    if (e.target.closest('a.exturl')) return;
    enterEdit();
  });

  function enterEdit() {
    if (editing) return;
    editing = true;
    const ta = el('textarea', { class: 'note-edit', spellcheck: 'true' });
    ta.value = page.content;
    wrap.replaceChild(ta, view);
    autoresize(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const ac = attachAutocomplete(ta);

    const autosave = debounce(async () => {
      try {
        const u = await api.updatePage(state.notebookId, page.id, { content: ta.value });
        Object.assign(page, u);
        onSaved?.(u);
      } catch { /* keep editing; will retry on blur */ }
    }, 700);

    ta.addEventListener('input', () => { autoresize(ta); autosave(); });
    ta.addEventListener('keydown', (e) => {
      if (ac.handleKey(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); ta.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
    });
    ta.addEventListener('blur', async () => {
      // Give a click on an autocomplete item time to run first.
      setTimeout(() => commit(), 120);
    });

    let committed = false;
    async function commit() {
      if (committed || !ac) return;
      if (ac.isOpen()) return; // still choosing a suggestion
      committed = true;
      editing = false;
      ac.destroy();
      try {
        const u = await api.updatePage(state.notebookId, page.id, { content: ta.value });
        Object.assign(page, u);
        onSaved?.(u);
      } catch (e) { /* leave content as-is */ }
      view.innerHTML = renderNoteHtml(page.content);
      if (ta.parentNode === wrap) wrap.replaceChild(view, ta);
    }
  }

  return { wrap };
}

/* ------------------------- [[ link autocomplete ------------------------ */

function attachAutocomplete(ta) {
  let box = null;
  let items = [];
  let active = 0;

  function activeQuery() {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const open = before.lastIndexOf('[[');
    if (open === -1) return null;
    const between = before.slice(open + 2);
    if (/[\[\]\n]/.test(between)) return null;
    return { query: between.trim(), start: open + 2, end: pos };
  }

  function close() {
    if (box) { box.remove(); box = null; }
    items = [];
  }

  function open(q) {
    const lower = q.query.toLowerCase();
    items = state.pageTitles
      .filter((t) => t.toLowerCase().includes(lower))
      .slice(0, 8);
    const showCreate = q.query && !state.pageTitles.some((t) => t.toLowerCase() === lower);
    if (!items.length && !showCreate) { close(); return; }
    active = 0;
    if (!box) {
      box = el('div', { class: 'ac-box' });
      document.body.append(box);
    }
    box.innerHTML = '';
    items.forEach((t, i) => {
      const it = el('div', { class: 'ac-item' + (i === active ? ' active' : '') }, [el('span', { text: t })]);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); choose(t); });
      box.append(it);
    });
    if (showCreate) {
      const it = el('div', { class: 'ac-item ac-create' + (items.length === 0 ? ' active' : '') },
        [el('span', { text: `Create “${q.query}”` })]);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); choose(q.query); });
      box.append(it);
      items.push(q.query); // selectable via keyboard
      if (items.length === 1) active = 0;
    }
    const r = ta.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${Math.min(r.bottom, window.innerHeight - 220)}px`;
    box.style.width = `${Math.min(r.width, 320)}px`;
  }

  function choose(title) {
    const q = activeQuery();
    if (!q) { close(); return; }
    const before = ta.value.slice(0, q.start);
    const after = ta.value.slice(q.end);
    const hasClose = after.startsWith(']]');
    ta.value = before + title + (hasClose ? '' : ']]') + after;
    const caret = before.length + title.length + 2;
    ta.setSelectionRange(caret, caret);
    close();
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }

  function refresh() {
    const q = activeQuery();
    if (!q) { close(); return; }
    open(q);
  }

  const onInput = () => refresh();
  ta.addEventListener('input', onInput);
  ta.addEventListener('click', () => { const q = activeQuery(); q ? open(q) : close(); });

  return {
    isOpen: () => !!box,
    handleKey(e) {
      if (!box) return false;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; paint(); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(items[active]); return true; }
      if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
      return false;
    },
    destroy: () => { ta.removeEventListener('input', onInput); close(); },
  };

  function paint() {
    if (!box) return;
    [...box.children].forEach((c, i) => c.classList.toggle('active', i === active));
  }
}
