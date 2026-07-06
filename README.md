# 📓 Notepad

A [Reflect](https://reflect.app)-style notetaking app: a **daily notes** timeline,
**wiki-style backlinks** with `[[double brackets]]`, and fully **isolated
notebooks** — notebooks never share backlinks.

It's a completely static web app: no server, no database, no account, no build
step, nothing to install. Everything runs in your browser, and your notes are
stored privately in your browser's local storage — they never leave your device.

**Use it here → <https://peytonfrankecode.github.io/Notepad/>**

## Features

- **Daily notes** — every day gets its own card in a reverse-chronological feed,
  labelled by day of the month. Today is always ready to write in; past days
  appear once they have content. "Load earlier days" pages back through history.
- **Backlinks with `[[wiki links]]`** — type `[[Some Page]]` in any note. Click it
  to jump to that page (auto-created on first visit). Each page shows its
  **Linked references** — every note that links to it, with surrounding context.
- **`[[` autocomplete** — start typing `[[` and pick from existing pages and any
  title you've referenced before, or create a new one inline.
- **Notebooks** — organize notes into separate notebooks. Each notebook has its
  own daily feed, its own pages, and **its own backlink graph** — a `[[Project]]`
  link in one notebook is entirely independent of the same name in another.
- **Export / Import** — download all your notes as a JSON file from the sidebar,
  and import it on another device (or keep it as a backup).

## Your data

Notes live in `localStorage` under the site's origin, so they are private to
your browser profile and persist between visits. Because there's no server:

- Different browsers/devices each have their own notes — use **Export** /
  **Import** in the sidebar to move them.
- Clearing the site's browsing data deletes your notes — keep an export as a
  backup if they matter.

## How it works

Plain HTML + CSS + dependency-free vanilla JavaScript (ES modules) in
[`docs/`](docs/), served by GitHub Pages:

```
docs/
├── index.html      app shell
├── css/styles.css
└── js/
    ├── app.js      UI: daily feed, pages, sidebar, [[ autocomplete
    ├── api.js      data layer: notebooks/pages/links in localStorage
    └── util.js     DOM + note-rendering helpers
```

- A **page** is any note with a title. Daily notes are pages whose title is the
  ISO date, displayed as "Monday, July 6, 2026".
- When a page is saved, its `[[links]]` are parsed and rewritten into a links
  list, **always scoped to that page's notebook**.
- **Backlinks** for a page are every link entry (same notebook) whose target
  title matches — which is why notebooks are perfectly isolated.

## Running it yourself

Host the `docs/` folder on any static host (GitHub Pages serves it from this
repo), or serve it locally with any static file server, e.g.:

```bash
python3 -m http.server -d docs
```

(ES modules don't load from `file://` URLs, so it needs to be served over HTTP.)
