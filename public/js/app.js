import { api } from './api.js';
import { el, renderNoteHtml, formatDate, todayISO, debounce } from './util.js';
import { editableNote } from './editor.js';

const root = document.getElementById('root');
const LS_NB = 'nodebook.notebookId';
const LS_SORT = 'nodebook.pageSort';

const state = {
  user: null,
  notebooks: [],
  notebookId: null,
  view: 'daily', // 'daily' | 'day' | 'page'
  page: null,
  dayDate: null,
  pageTitles: [],
  pageSort: localStorage.getItem(LS_SORT) || 'updated',
};

/* --------------------------------- boot ----------------------------------- */

setupGlobalKeys();
init();
async function init() {
  try {
    const { user } = await api.me();
    state.user = user;
    await loadWorkspace();
  } catch {
    renderAuth();
  }
}

async function loadWorkspace() {
  state.notebooks = await api.listNotebooks();
  const saved = Number(localStorage.getItem(LS_NB));
  state.notebookId = state.notebooks.some((n) => n.id === saved) ? saved : state.notebooks[0]?.id;
  await refreshTitles();
  state.view = 'daily';
  renderApp();
}

async function refreshTitles() {
  try { state.pageTitles = await api.listTitles(state.notebookId); } catch { state.pageTitles = []; }
}

/* --------------------------------- auth ----------------------------------- */

function renderAuth() {
  let mode = 'login';
  const draw = () => {
    root.innerHTML = '';
    const err = el('div', { class: 'auth-error' });
    const email = el('input', { class: 'field', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
    const pass = el('input', { class: 'field', type: 'password', placeholder: 'Password (min 6 chars)', autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
    const submit = el('button', { class: 'btn primary', type: 'submit' }, mode === 'login' ? 'Log in' : 'Create account');

    const form = el('form', {
      class: 'auth-form',
      onSubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        submit.disabled = true;
        try {
          const { user } = await (mode === 'login' ? api.login : api.register)(email.value.trim(), pass.value);
          state.user = user;
          await loadWorkspace();
        } catch (ex) { err.textContent = ex.message; submit.disabled = false; }
      },
    }, [
      el('label', { class: 'field-label', text: 'Email' }), email,
      el('label', { class: 'field-label', text: 'Password' }), pass,
      err, submit,
    ]);

    root.append(el('div', { class: 'auth-wrap' }, [
      el('div', { class: 'auth-card' }, [
        el('div', { class: 'auth-brand' }, [el('span', { class: 'logo', text: '📓' }), el('span', { text: 'Nodebook' })]),
        el('p', { class: 'auth-tag', text: 'Daily notes, backlinks, and notebooks — your own private space.' }),
        form,
        el('button', {
          class: 'link-btn', type: 'button',
          onClick: () => { mode = mode === 'login' ? 'register' : 'login'; draw(); },
        }, mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'),
      ]),
    ]));
    email.focus();
  };
  draw();
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
  else if (state.view === 'day') renderDay(main);
  else if (state.view === 'tasks') renderTasks(main);
  else renderPage(main);
}

// Shift a YYYY-MM-DD string by n days.
function shiftDate(isoStr, n) {
  const [y, m, d] = isoStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function openDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  state.dayDate = date;
  state.view = 'day';
  renderApp();
}

/* -------------------------------- sidebar --------------------------------- */

function renderSidebar() {
  const side = el('aside', { class: 'sidebar' });
  side.append(el('div', { class: 'brand' }, [el('span', { class: 'logo', text: '📓' }), el('span', { text: 'Nodebook' })]));

  const select = el('select', { class: 'nb-select', onChange: (e) => switchNotebook(Number(e.target.value)) });
  for (const n of state.notebooks) {
    select.append(el('option', { value: n.id, selected: n.id === state.notebookId }, `${n.name} (${n.pageCount})`));
  }
  side.append(el('div', { class: 'side-section' }, [
    el('label', { class: 'side-label', text: 'Notebook' }),
    el('div', { class: 'nb-row' }, [
      select,
      el('button', { class: 'icon-btn', title: 'New notebook', onClick: newNotebook }, '＋'),
      el('button', { class: 'icon-btn', title: 'Notebook options', onClick: openNotebookMenu }, '⋯'),
    ]),
  ]));

  side.append(el('button', { class: `nav-item${state.view === 'daily' ? ' active' : ''}`, onClick: () => navigate('daily') },
    [el('span', { class: 'nav-ic', text: '🗓️' }), 'Daily Notes']));
  side.append(el('button', { class: `nav-item${state.view === 'tasks' ? ' active' : ''}`, onClick: () => navigate('tasks') },
    [el('span', { class: 'nav-ic', text: '✅' }), 'Tasks']));

  const search = el('input', { class: 'search', type: 'search', placeholder: 'Search this notebook…' });
  const results = el('div', { class: 'page-list' });
  const sort = el('select', { class: 'sort-select', title: 'Sort pages' }, [
    el('option', { value: 'updated', selected: state.pageSort === 'updated' }, 'Recently updated'),
    el('option', { value: 'created', selected: state.pageSort === 'created' }, 'Recently created'),
    el('option', { value: 'name', selected: state.pageSort === 'name' }, 'Name (A–Z)'),
  ]);
  const load = async () => {
    const q = search.value.trim();
    renderPageList(results, await api.listPages(state.notebookId, q), q);
  };
  sort.addEventListener('change', () => { state.pageSort = sort.value; localStorage.setItem(LS_SORT, sort.value); load(); });
  search.addEventListener('input', debounce(load, 180));
  side.append(el('div', { class: 'side-section grow' }, [
    el('div', { class: 'pages-head' }, [el('label', { class: 'side-label', text: 'Pages' }), sort]),
    search, results,
  ]));
  load();

  side.append(el('div', { class: 'user-row' }, [
    el('span', { class: 'user-email', title: state.user.email, text: state.user.email }),
    el('button', { class: 'link-btn', title: 'Keyboard shortcuts (?)', onClick: openShortcuts }, '⌨'),
    el('button', { class: 'link-btn', onClick: doLogout }, 'Log out'),
  ]));
  return side;
}

// `q` present => a search: show all matches (incl. daily). Otherwise show topic
// (non-daily) pages, since daily entries live in the feed / date picker.
function renderPageList(container, pages, q) {
  container.innerHTML = '';
  let list = q ? pages : pages.filter((p) => !p.isDaily);
  const label = (p) => (p.isDaily ? formatDate(p.dailyDate).full : p.title);
  const key = state.pageSort;
  list = list.slice().sort((a, b) => {
    if (key === 'name') return label(a).localeCompare(label(b));
    if (key === 'created') return a.createdAt < b.createdAt ? 1 : -1;
    return a.updatedAt < b.updatedAt ? 1 : -1; // updated
  });
  if (!list.length) { container.append(el('div', { class: 'empty-hint', text: q ? 'No matches.' : 'No pages yet — type [[ in a note to create one.' })); return; }
  for (const p of list) {
    container.append(el('button', { class: 'page-link', onClick: () => openPageById(p.id) },
      [el('span', { class: 'page-ic', text: p.isDaily ? '🗓️' : '📄' }), el('span', { class: 'page-name', text: label(p) })]));
  }
}

async function switchNotebook(id) {
  state.notebookId = id;
  localStorage.setItem(LS_NB, String(id));
  state.view = 'daily';
  state.page = null;
  await refreshTitles();
  renderApp();
}

async function newNotebook() {
  const name = prompt('Name your new notebook:', 'New notebook');
  if (!name?.trim()) return;
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
      if (!name?.trim()) return;
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
  const r = e.currentTarget.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${r.left}px`;
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
}

function closeMenus() { document.querySelectorAll('.menu').forEach((m) => m.remove()); }

async function doLogout() {
  await api.logout();
  location.reload();
}

/* ------------------------------ keyboard help ----------------------------- */

const SHORTCUTS = [
  { section: 'Editing a note' },
  { keys: ['⌘/Ctrl', 'B'], desc: 'Bold' },
  { keys: ['⌘/Ctrl', 'I'], desc: 'Italic' },
  { keys: ['⌘/Ctrl', '⇧', 'X'], desc: 'Strikethrough' },
  { keys: ['⌘/Ctrl', 'E'], desc: 'Inline code' },
  { keys: ['⌘/Ctrl', '⇧', '8'], desc: 'Toggle bullet' },
  { keys: ['⌘/Ctrl', '⇧', '9'], desc: 'Toggle checkbox task' },
  { keys: ['⌘/Ctrl', '⇧', 'H'], desc: 'Toggle heading' },
  { keys: ['Tab'], desc: 'Indent bullet' },
  { keys: ['⇧', 'Tab'], desc: 'Outdent bullet' },
  { keys: ['Enter'], desc: 'New bullet (empty bullet ends the list)' },
  { keys: ['[['], desc: 'Link to a page (autocomplete)' },
  { keys: ['⌘/Ctrl', 'Enter'], desc: 'Save & finish editing' },
  { keys: ['Esc'], desc: 'Save & finish editing' },
  { section: 'Anywhere' },
  { keys: ['⌘/Ctrl', 'K'], desc: 'Search this notebook' },
  { keys: ['?'], desc: 'Show this shortcuts panel' },
];

function openShortcuts() {
  closeShortcuts();
  const kbd = (k) => el('kbd', { class: 'kbd', text: k });
  const rows = SHORTCUTS.map((s) => s.section
    ? el('div', { class: 'sc-section', text: s.section })
    : el('div', { class: 'sc-row' }, [
        el('div', { class: 'sc-keys' }, s.keys.flatMap((k, i) => i ? [el('span', { class: 'sc-plus', text: '+' }), kbd(k)] : [kbd(k)])),
        el('div', { class: 'sc-desc', text: s.desc }),
      ]));
  const overlay = el('div', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) closeShortcuts(); } }, [
    el('div', { class: 'modal', role: 'dialog', 'aria-label': 'Keyboard shortcuts' }, [
      el('div', { class: 'modal-head' }, [
        el('h2', { class: 'modal-title', text: 'Keyboard shortcuts' }),
        el('button', { class: 'modal-x', title: 'Close', onClick: closeShortcuts }, '✕'),
      ]),
      el('div', { class: 'sc-list' }, rows),
    ]),
  ]);
  document.body.append(overlay);
}
function closeShortcuts() { document.querySelectorAll('.modal-overlay').forEach((m) => m.remove()); }

function isTyping(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function setupGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeShortcuts(); closePalette(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      if (state.user) { e.preventDefault(); openPalette(); }
      return;
    }
    if (e.key === '?' && !isTyping(e.target)) { e.preventDefault(); openShortcuts(); }
  });
}

/* ----------------------------- command palette ---------------------------- */

function closePalette() { document.querySelectorAll('.palette-overlay').forEach((m) => m.remove()); }

async function openPalette() {
  closePalette();
  let pages = [];
  try { pages = await api.listPages(state.notebookId); } catch { /* ignore */ }

  const input = el('input', { class: 'palette-input', type: 'text', placeholder: 'Jump to a page or day, or create one…', autocomplete: 'off' });
  const list = el('div', { class: 'palette-list' });
  const overlay = el('div', { class: 'palette-overlay', onClick: (e) => { if (e.target === overlay) closePalette(); } },
    [el('div', { class: 'palette' }, [input, list])]);
  document.body.append(overlay);
  input.focus();

  let items = [];
  let active = 0;

  const build = () => {
    const q = input.value.trim();
    const ql = q.toLowerCase();
    const matched = pages
      .filter((p) => (p.isDaily ? formatDate(p.dailyDate).full : p.title).toLowerCase().includes(ql))
      .slice(0, 20)
      .map((p) => ({ kind: 'page', page: p, label: p.isDaily ? formatDate(p.dailyDate).full : p.title, icon: p.isDaily ? '🗓️' : '📄' }));
    items = [{ kind: 'today', label: 'Go to Today', icon: '⭐' }, ...matched];
    if (q && !pages.some((p) => !p.isDaily && p.title.toLowerCase() === ql)) {
      items.push({ kind: 'create', label: `Create page “${q}”`, icon: '＋', title: q });
    }
    active = Math.min(active, items.length - 1);
    paint();
  };
  const paint = () => {
    list.innerHTML = '';
    items.forEach((it, i) => {
      const row = el('div', { class: `palette-item${i === active ? ' active' : ''}` },
        [el('span', { class: 'palette-ic', text: it.icon }), el('span', { text: it.label })]);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      list.append(row);
    });
  };
  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    closePalette();
    if (it.kind === 'today') navigate('daily');
    else if (it.kind === 'create') openPageByTitle(it.title);
    else if (it.page.isDaily) openDay(it.page.dailyDate);
    else openPageById(it.page.id);
  };

  input.addEventListener('input', build);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  build();
}

/* ------------------------------- navigation ------------------------------- */

function openPage(page) { state.page = page; state.view = 'page'; renderApp(); }

async function openPageById(id) {
  try { openPage(await api.getPage(state.notebookId, id)); } catch (e) { alert(e.message); }
}

async function openPageByTitle(title) {
  try {
    const page = await api.getPageByTitle(state.notebookId, title, true);
    await refreshTitles();
    openPage(page);
  } catch (e) { alert(e.message); }
}

// Shared context handed to every editable note.
function noteCtx(page, extra = {}) {
  return {
    getTitles: () => state.pageTitles,
    openLink: openPageByTitle,
    save: (content) => api.updatePage(state.notebookId, page.id, { content }),
    toggleTask: (lineIndex) => api.toggleTask(state.notebookId, page.id, lineIndex),
    onSaved: () => refreshTitles(),
    ...extra,
  };
}

/* ------------------------------ daily log view ---------------------------- */

async function renderDaily(main) {
  let feed;
  try { feed = await api.dailyFeed(state.notebookId, { today: todayISO() }); }
  catch (e) { main.innerHTML = `<div class="error">${e.message}</div>`; return; }

  main.innerHTML = '';
  const jump = el('input', { class: 'date-jump', type: 'date', value: todayISO(), title: 'Jump to a date' });
  jump.addEventListener('change', () => jump.value && openDay(jump.value));
  main.append(el('div', { class: 'view-head' }, [
    el('h1', { text: 'Daily Notes' }),
    el('label', { class: 'jump-label' }, [el('span', { text: 'Jump to' }), jump]),
  ]));
  const log = el('div', { class: 'daily-log' });
  main.append(log);

  feed.forEach((page, i) => log.append(dayBlock(page, i === 0)));

  if (feed.length) main.append(makeLoadMore(log, feed[feed.length - 1].dailyDate));
}

function makeLoadMore(log, oldest) {
  const btn = el('button', { class: 'load-more' }, 'Load earlier days');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const more = await api.dailyFeed(state.notebookId, { before: oldest, today: todayISO() });
    if (!more.length) { btn.textContent = 'No earlier days'; return; }
    more.forEach((p) => log.append(dayBlock(p, false)));
    btn.replaceWith(makeLoadMore(log, more[more.length - 1].dailyDate));
  });
  return btn;
}

// One day in the continuous log: a date divider + its note + linked refs.
// The user never titles anything — today is auto-created and ready to type.
function dayBlock(page, isFirst) {
  const f = formatDate(page.dailyDate);
  const block = el('div', { class: `day-block${f.isToday ? ' today' : ''}` });

  block.append(el('div', { class: 'day-divider' }, [
    el('span', { class: 'day-dot' }),
    el('span', { class: 'day-label' }, [
      f.isToday ? el('span', { class: 'day-today', text: 'Today' }) : null,
      el('span', { class: 'day-full', text: f.isToday ? f.full.replace(/^\w+, /, '') : f.full }),
    ]),
  ]));

  const blWrap = el('div', { class: 'backlinks' });
  const note = editableNote(page, noteCtx(page, {
    placeholder: f.isToday ? 'Start writing today’s notes…  (type [[ to link, - for bullets)' : 'Empty — click to write…',
    autofocus: isFirst && f.isToday && !page.content,
    onSaved: () => { renderBacklinks(blWrap, page); refreshTitles(); },
  }));
  renderBacklinks(blWrap, page);

  block.append(el('div', { class: 'day-body' }, [note.wrap, blWrap]));
  return block;
}

// Focused view of a single day (used when jumping to a specific date).
async function renderDay(main) {
  const date = state.dayDate;
  let page;
  try { page = await api.getDailyPage(state.notebookId, date); }
  catch (e) { main.innerHTML = `<div class="error">${e.message}</div>`; return; }

  const f = formatDate(date);
  main.innerHTML = '';

  const jump = el('input', { class: 'date-jump', type: 'date', value: date });
  jump.addEventListener('change', () => jump.value && openDay(jump.value));
  main.append(el('div', { class: 'view-head' }, [
    el('button', { class: 'back-btn', onClick: () => navigate('daily') }, '← Daily Notes'),
    el('div', { class: 'day-nav' }, [
      el('button', { class: 'icon-btn', title: 'Previous day', onClick: () => openDay(shiftDate(date, -1)) }, '‹'),
      jump,
      el('button', { class: 'icon-btn', title: 'Next day', onClick: () => openDay(shiftDate(date, 1)) }, '›'),
    ]),
  ]));

  const blWrap = el('div', { class: 'backlinks' });
  const note = editableNote(page, noteCtx(page, {
    placeholder: `Add notes for ${f.full}…`,
    autofocus: !page.content,
    onSaved: () => { renderBacklinks(blWrap, page); refreshTitles(); },
  }));
  renderBacklinks(blWrap, page);

  main.append(el('div', { class: 'page-body' }, [
    el('div', { class: `day-block single${f.isToday ? ' today' : ''}` }, [
      el('div', { class: 'day-divider' }, [
        el('span', { class: 'day-dot' }),
        el('span', { class: 'day-label' }, [
          f.isToday ? el('span', { class: 'day-today', text: 'Today' }) : null,
          el('span', { class: 'day-full', text: f.full }),
        ]),
      ]),
      el('div', { class: 'day-body' }, [note.wrap, blWrap]),
    ]),
  ]));
}

/* -------------------------------- tasks view ------------------------------ */

const taskView = { q: '', source: 'all', showDone: false, sortKey: 'day', sortDir: -1 };

async function renderTasks(main) {
  let all;
  try { all = await api.listTasks(state.notebookId); }
  catch (e) { main.innerHTML = `<div class="error">${e.message}</div>`; return; }

  main.innerHTML = '';
  const count = el('span', { class: 'task-count' });
  main.append(el('div', { class: 'view-head' }, [el('h1', { text: 'Tasks' }), count]));

  const search = el('input', { class: 'search task-search', type: 'search', placeholder: 'Filter tasks…', value: taskView.q });
  const source = el('select', { class: 'sort-select' }, [
    el('option', { value: 'all', selected: taskView.source === 'all' }, 'All sources'),
    el('option', { value: 'daily', selected: taskView.source === 'daily' }, 'Daily notes'),
    el('option', { value: 'pages', selected: taskView.source === 'pages' }, 'Pages'),
  ]);
  const doneToggle = el('label', { class: 'task-done-toggle' }, [
    el('input', { type: 'checkbox', ...(taskView.showDone ? { checked: '' } : {}) }), 'Show completed',
  ]);
  const tableWrap = el('div', { class: 'tasks-table-wrap' });
  main.append(el('div', { class: 'tasks-toolbar' }, [search, source, doneToggle]), tableWrap);

  search.addEventListener('input', () => { taskView.q = search.value; rebuild(); });
  source.addEventListener('change', () => { taskView.source = source.value; rebuild(); });
  doneToggle.querySelector('input').addEventListener('change', (e) => { taskView.showDone = e.target.checked; rebuild(); });

  const dayVal = (t) => (t.isDaily ? t.dailyDate : '');
  const pageVal = (t) => (t.isDaily ? '' : t.title);

  function rebuild() {
    const q = taskView.q.trim().toLowerCase();
    let rows = all.filter((t) => {
      if (!taskView.showDone && t.checked) return false;
      if (taskView.source === 'daily' && !t.isDaily) return false;
      if (taskView.source === 'pages' && t.isDaily) return false;
      if (q && !t.text.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = taskView.sortDir;
    rows.sort((a, b) => {
      let av; let bv;
      if (taskView.sortKey === 'task') { av = a.text.toLowerCase(); bv = b.text.toLowerCase(); }
      else if (taskView.sortKey === 'page') { av = pageVal(a).toLowerCase(); bv = pageVal(b).toLowerCase(); }
      else { av = dayVal(a); bv = dayVal(b); } // day
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    count.textContent = `${all.filter((t) => !t.checked).length} open · ${rows.length} shown`;

    tableWrap.innerHTML = '';
    if (!rows.length) {
      tableWrap.append(el('div', { class: 'tasks-empty' }, ['No tasks. Add one in a note with ', el('code', { text: '- [ ] something' }), ' (or the ☑ button).']));
      return;
    }
    const arrow = (k) => (taskView.sortKey === k ? (taskView.sortDir === 1 ? ' ▲' : ' ▼') : '');
    const th = (label, key) => {
      const cell = el('th', { class: `th-sort${taskView.sortKey === key ? ' active' : ''}`, text: label + arrow(key) });
      cell.addEventListener('click', () => {
        if (taskView.sortKey === key) taskView.sortDir *= -1; else { taskView.sortKey = key; taskView.sortDir = key === 'task' ? 1 : -1; }
        rebuild();
      });
      return cell;
    };
    const table = el('table', { class: 'tasks-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { class: 'th-check' }), th('Task', 'task'), th('Day', 'day'), th('Page', 'page')])]),
    ]);
    const tbody = el('tbody');
    for (const t of rows) {
      const box = el('span', { class: 'task-box', role: 'checkbox', 'aria-checked': String(!!t.checked), 'data-checked': t.checked ? '1' : '0' });
      const desc = el('td', { class: 'td-task' + (t.checked ? ' done' : ''), html: renderNoteHtml(t.text, { placeholder: '' }) });
      desc.addEventListener('click', (e) => { const l = e.target.closest('a.wikilink'); if (l) { e.preventDefault(); openPageByTitle(l.dataset.link); } });
      const dayCell = el('td', { class: 'td-day' }, t.isDaily
        ? [el('a', { href: '#', class: 'cell-link', onClick: (e) => { e.preventDefault(); openDay(t.dailyDate); } }, formatDate(t.dailyDate).full)]
        : [el('span', { class: 'muted', text: '—' })]);
      const pageCell = el('td', { class: 'td-page' }, t.isDaily
        ? [el('span', { class: 'muted', text: '—' })]
        : [el('a', { href: '#', class: 'cell-link', onClick: (e) => { e.preventDefault(); openPageById(t.pageId); } }, t.title)]);
      const tr = el('tr', { class: t.checked ? 'task-tr done' : 'task-tr' }, [el('td', { class: 'td-check' }, [box]), desc, dayCell, pageCell]);
      box.addEventListener('click', async () => {
        try {
          await api.toggleTask(state.notebookId, t.pageId, t.lineIndex);
          t.checked = !t.checked;
          rebuild();
        } catch (ex) { alert(ex.message); }
      });
      tbody.append(tr);
    }
    table.append(tbody);
    tableWrap.append(table);
  }
  rebuild();
}

/* -------------------------------- page view ------------------------------- */

async function renderPage(main) {
  const page = state.page;
  main.innerHTML = '';
  main.append(el('div', { class: 'view-head' }, [
    el('button', { class: 'back-btn', onClick: () => navigate('daily') }, '← Daily Notes'),
    !page.isDaily ? el('button', { class: 'del-btn', onClick: deleteCurrentPage }, 'Delete page') : null,
  ]));

  const titleText = page.isDaily ? formatDate(page.dailyDate).full : page.title;
  const title = el('input', { class: 'page-title', value: titleText });
  if (page.isDaily) title.setAttribute('readonly', '');
  else title.addEventListener('change', async () => {
    const v = title.value.trim();
    if (!v || v === page.title) { title.value = page.title; return; }
    try {
      Object.assign(page, await api.updatePage(state.notebookId, page.id, { title: v }));
      await refreshTitles();
      renderApp(); // reflect the rename + refreshed references
    } catch (e) { alert(e.message); title.value = page.title; }
  });

  const blWrap = el('div', { class: 'backlinks' });
  const note = editableNote(page, noteCtx(page, {
    onSaved: () => { renderBacklinks(blWrap, page); refreshTitles(); loadUnlinked(page, unlinkedWrap); },
  }));
  renderBacklinks(blWrap, page);

  const unlinkedWrap = el('div', { class: 'unlinked' });
  main.append(el('div', { class: 'page-body' }, [title, note.wrap, el('div', { class: 'bl-sep' }), blWrap, unlinkedWrap]));
  loadUnlinked(page, unlinkedWrap);
}

// Show notes that mention this page's title as plain text, with a Link action.
async function loadUnlinked(page, wrap) {
  wrap.innerHTML = '';
  let mentions = [];
  try { mentions = await api.unlinked(state.notebookId, page.id); } catch { return; }
  if (!mentions.length) return;
  wrap.append(el('div', { class: 'bl-head', text: `${mentions.length} unlinked mention${mentions.length > 1 ? 's' : ''}` }));
  for (const m of mentions) {
    const label = m.isDaily ? formatDate(m.dailyDate).full : m.title;
    const item = el('div', { class: 'bl-item' }, [
      el('div', { class: 'unlinked-top' }, [
        el('a', { class: 'bl-title', href: '#', onClick: (e) => { e.preventDefault(); m.isDaily ? openDay(m.dailyDate) : openPageById(m.id); } }, label),
        el('button', { class: 'link-mention-btn', title: `Link this mention to ${page.title}`,
          onClick: async (e) => {
            e.preventDefault();
            const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Linking…';
            try {
              Object.assign(page, await api.linkMention(state.notebookId, page.id, m.id));
              await refreshTitles();
              renderApp();
            } catch (ex) { alert(ex.message); btn.disabled = false; btn.textContent = 'Link'; }
          } }, 'Link'),
      ]),
      el('div', { class: 'bl-context', html: renderNoteHtml(m.snippet || '', { placeholder: '' }) }),
    ]);
    wrap.append(item);
  }
}

async function deleteCurrentPage() {
  const page = state.page;
  if (!confirm(`Delete “${page.title}”?`)) return;
  await api.deletePage(state.notebookId, page.id);
  await refreshTitles();
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
    const ctx = el('div', { class: 'bl-context', html: renderNoteHtml(b.context || '', { placeholder: '' }) });
    ctx.addEventListener('click', (e) => {
      const l = e.target.closest('a.wikilink');
      if (l) { e.preventDefault(); openPageByTitle(l.dataset.link); }
    });
    wrap.append(el('div', { class: 'bl-item' }, [
      el('a', { class: 'bl-title', href: '#', onClick: (e) => { e.preventDefault(); b.isDaily ? openPageByTitle(b.title) : openPageById(b.id); } }, label),
      ctx,
    ]));
  }
}
