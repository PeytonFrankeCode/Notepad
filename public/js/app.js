import { api } from './api.js';
import { el, renderNoteHtml, formatDate, todayISO, debounce } from './util.js';
import { editableNote } from './editor.js';

const root = document.getElementById('root');
const LS_NB = 'notepad.notebookId';

const state = {
  user: null,
  notebooks: [],
  notebookId: null,
  view: 'daily', // 'daily' | 'page'
  page: null,
  pageTitles: [],
};

/* --------------------------------- boot ----------------------------------- */

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
        el('div', { class: 'auth-brand' }, [el('span', { class: 'logo', text: '📓' }), el('span', { text: 'Notepad' })]),
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
  else renderPage(main);
}

/* -------------------------------- sidebar --------------------------------- */

function renderSidebar() {
  const side = el('aside', { class: 'sidebar' });
  side.append(el('div', { class: 'brand' }, [el('span', { class: 'logo', text: '📓' }), el('span', { text: 'Notepad' })]));

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
  side.append(el('button', { class: 'nav-item', onClick: newPage }, [el('span', { class: 'nav-ic', text: '📄' }), 'New page']));

  const search = el('input', { class: 'search', type: 'search', placeholder: 'Search this notebook…' });
  const results = el('div', { class: 'page-list' });
  const run = debounce(async () => renderPageList(results, await api.listPages(state.notebookId, search.value.trim())), 180);
  search.addEventListener('input', run);
  side.append(el('div', { class: 'side-section grow' }, [el('label', { class: 'side-label', text: 'Pages' }), search, results]));
  api.listPages(state.notebookId).then((p) => renderPageList(results, p));

  side.append(el('div', { class: 'user-row' }, [
    el('span', { class: 'user-email', title: state.user.email, text: state.user.email }),
    el('button', { class: 'link-btn', onClick: doLogout }, 'Log out'),
  ]));
  return side;
}

function renderPageList(container, pages) {
  container.innerHTML = '';
  if (!pages.length) { container.append(el('div', { class: 'empty-hint', text: 'No pages yet.' })); return; }
  for (const p of pages) {
    const label = p.isDaily ? formatDate(p.dailyDate).full : p.title;
    container.append(el('button', { class: 'page-link', onClick: () => openPageById(p.id) },
      [el('span', { class: 'page-ic', text: p.isDaily ? '🗓️' : '📄' }), el('span', { class: 'page-name', text: label })]));
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

async function newPage() {
  const title = prompt('Title for the new page:');
  if (!title?.trim()) return;
  try {
    const page = await api.createPage(state.notebookId, title.trim());
    await refreshTitles();
    openPage(page);
  } catch (e) { alert(e.message); }
}

async function doLogout() {
  await api.logout();
  location.reload();
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
  main.append(el('div', { class: 'view-head' }, [el('h1', { text: 'Daily Notes' })]));
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
    try { Object.assign(page, await api.updatePage(state.notebookId, page.id, { title: v })); await refreshTitles(); }
    catch (e) { alert(e.message); title.value = page.title; }
  });

  const blWrap = el('div', { class: 'backlinks' });
  const note = editableNote(page, noteCtx(page, {
    onSaved: () => { renderBacklinks(blWrap, page); refreshTitles(); },
  }));
  renderBacklinks(blWrap, page);

  main.append(el('div', { class: 'page-body' }, [title, note.wrap, el('div', { class: 'bl-sep' }), blWrap]));
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
