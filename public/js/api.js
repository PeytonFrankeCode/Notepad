// Thin wrapper around fetch. Auth is carried by an httpOnly cookie, so we
// just need credentials: 'include'. Throws Error(message) on non-2xx.

async function request(method, url, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const q = (params) =>
  '?' + Object.entries(params).filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

export const api = {
  // auth
  register: (email, password) => request('POST', '/api/auth/register', { email, password }),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/auth/me'),

  // notebooks
  listNotebooks: () => request('GET', '/api/notebooks'),
  createNotebook: (name) => request('POST', '/api/notebooks', { name }),
  renameNotebook: (id, name) => request('PATCH', `/api/notebooks/${id}`, { name }),
  deleteNotebook: (id) => request('DELETE', `/api/notebooks/${id}`),

  // pages
  listPages: (nbId, search) => request('GET', `/api/notebooks/${nbId}/pages` + (search ? q({ q: search }) : '')),
  listTitles: (nbId) => request('GET', `/api/notebooks/${nbId}/titles`),
  dailyFeed: (nbId, opts = {}) => request('GET', `/api/notebooks/${nbId}/daily` + q({ today: opts.today, before: opts.before, limit: opts.limit })),
  getPageByTitle: (nbId, title, create = true) =>
    request('GET', `/api/notebooks/${nbId}/page` + q({ title, create: create ? 1 : 0 })),
  getPage: (nbId, id) => request('GET', `/api/notebooks/${nbId}/pages/${id}`),
  createPage: (nbId, title) => request('POST', `/api/notebooks/${nbId}/pages`, { title }),
  updatePage: (nbId, id, patch) => request('PUT', `/api/notebooks/${nbId}/pages/${id}`, patch),
  deletePage: (nbId, id) => request('DELETE', `/api/notebooks/${nbId}/pages/${id}`),
};
