# 📓 Notepad

A [Reflect](https://reflect.app)-style notetaking app: a **daily notes** timeline,
**wiki-style backlinks** with `[[double brackets]]`, and fully **isolated
notebooks** — notebooks never share backlinks.

It ships in two flavors from this one repo:

| | Where it runs | Accounts | Where notes live |
|---|---|---|---|
| **Cloud app** (`public/` + `functions/`) | [Cloudflare Pages](#deploying-to-cloudflare-pages), on Cloudflare's global network | Email + password | Cloudflare D1 (SQLite) — synced across your devices |
| **In-browser app** (`docs/`) | GitHub Pages: <https://peytonfrankecode.github.io/Notepad/> | None needed | Your browser's localStorage — private to your device |

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
- **Accounts** (cloud app) — register / log in with email + password. Each user
  gets a completely private workspace. Passwords are hashed (PBKDF2); sessions
  use a signed, httpOnly JWT cookie.

## Deploying to Cloudflare Pages

No build tools needed — Cloudflare deploys straight from GitHub and redeploys
on every push. One-time setup in the [Cloudflare dashboard](https://dash.cloudflare.com):

1. **Connect the repo** — *Workers & Pages → Create → Pages → Connect to Git*,
   authorize GitHub, and pick this repository.
2. **Build settings** — Framework preset: **None** · Build command: *(leave
   empty)* · Build output directory: **`public`**. Save and deploy.
3. **Create the database** — *Storage & Databases → D1 → Create database*,
   name it anything (e.g. `notepad-db`).
4. **Bind it** — in the Pages project: *Settings → Bindings → Add → D1
   database* · Variable name: **`DB`** · select your database.
5. **Redeploy** — *Deployments → ⋯ on the latest → Retry deployment* so the
   binding takes effect.

That's it. The API creates its own tables on first request, and generates and
stores its own session-signing secret in D1 (set a `JWT_SECRET` environment
variable in the project settings if you'd rather control it yourself).
Your app is live at `https://<project>.pages.dev` on Cloudflare's global edge.

## How it works

```
public/                     the cloud app frontend (vanilla JS, no build step)
├── index.html
├── css/styles.css
└── js/
    ├── app.js              UI: auth, daily feed, pages, [[ autocomplete
    ├── api.js              fetch wrapper for /api/*
    └── util.js             DOM + note-rendering helpers
functions/
└── api/[[route]].js        the whole API as one Cloudflare Pages Function
                            (D1/SQLite storage, WebCrypto PBKDF2 + JWT auth)
docs/                       the standalone in-browser version (GitHub Pages);
                            same UI, with a localStorage data layer instead
```

- A **page** is any note with a title. Daily notes are pages whose title is the
  ISO date, displayed as "Monday, July 6, 2026".
- When a page is saved, its `[[links]]` are parsed and rewritten into the
  `links` table, **always scoped to that page's notebook**.
- **Backlinks** for a page are every link row (same notebook) whose target
  title matches — which is why notebooks are perfectly isolated.
- Every notebook-scoped route verifies the notebook belongs to the
  authenticated user before doing anything.

## Local development

```bash
npx wrangler pages dev public --d1=DB
```

This serves the cloud app at <http://localhost:8788> with a local D1 database
(no Cloudflare account needed). The `docs/` version needs any static file
server, e.g. `python3 -m http.server -d docs`.
