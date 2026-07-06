# 📓 Notepad

A [Reflect](https://reflect.app)-style notetaking app: a **daily notes** timeline,
**wiki-style backlinks** with `[[double brackets]]`, private per-user accounts, and
fully **isolated notebooks** — notebooks never share backlinks.

## Features

- **Daily notes** — every day gets its own card in a reverse-chronological feed,
  labelled by day of the month. Today is always ready to write in; past days
  appear once they have content. "Load earlier days" pages back through history.
- **Backlinks with `[[wiki links]]`** — type `[[Some Page]]` in any note. Click it
  to jump to that page (auto-created on first visit). Each page shows its
  **Linked references** — every note that links to it, with surrounding context.
- **`[[` autocomplete** — start typing `[[` and pick from existing pages and any
  title you've referenced before, or create a new one inline.
- **Accounts** — register / log in with email + password. Each user gets a
  completely private workspace. Passwords are hashed (bcrypt); sessions use a
  signed, httpOnly JWT cookie.
- **Notebooks** — organize notes into separate notebooks. Each notebook has its
  own daily feed, its own pages, and **its own backlink graph** — a `[[Project]]`
  link in one notebook is entirely independent of the same name in another.

## Tech stack

- **Backend:** Node.js + Express, SQLite (`better-sqlite3`)
- **Auth:** `bcryptjs` password hashing, `jsonwebtoken` in an httpOnly cookie
- **Frontend:** dependency-free vanilla JavaScript (ES modules) + CSS — no build step
- **Storage:** a single SQLite file under `data/` (auto-created)

## Getting started

```bash
npm install
npm start
```

Then open <http://localhost:3000>, click **Sign up**, and start writing.

For auto-reload during development:

```bash
npm run dev
```

### Configuration

| Variable     | Default             | Purpose                                                        |
| ------------ | ------------------- | ------------------------------------------------------------- |
| `PORT`       | `3000`              | HTTP port                                                      |
| `JWT_SECRET` | random per start    | Set this in production so login sessions survive restarts.     |
| `DB_PATH`    | `data/notepad.sqlite` | SQLite file location                                         |

## How it works

### Data model

```
users ─┬─< notebooks ─┬─< pages   (daily notes are date-titled pages)
       │              └─< links    (one row per [[link]] occurrence)
```

- A **page** is any note with a title. Daily notes are pages whose title is the
  ISO date (`is_daily = 1`), displayed as "Monday, July 6, 2026".
- When a page is saved, its `[[links]]` are parsed and rewritten into the `links`
  table, **always scoped to that page's `notebook_id`**.
- **Backlinks** for a page are every row in `links` (same notebook) whose target
  title matches — which is why notebooks are perfectly isolated.

### API overview

| Method   | Route                                   | Purpose                              |
| -------- | --------------------------------------- | ------------------------------------ |
| `POST`   | `/api/auth/register` · `/login` · `/logout` | Account + session                |
| `GET`    | `/api/auth/me`                          | Current user                         |
| `GET/POST/PATCH/DELETE` | `/api/notebooks[/:id]`   | Manage notebooks                     |
| `GET`    | `/api/notebooks/:id/daily`              | Daily feed (auto-creates today)      |
| `GET`    | `/api/notebooks/:id/page?title=…`       | Get / create a page by title         |
| `GET`    | `/api/notebooks/:id/pages?q=…`          | List / search pages                  |
| `GET`    | `/api/notebooks/:id/titles`             | Link-autocomplete suggestions        |
| `PUT`    | `/api/notebooks/:id/pages/:pageId`      | Save a note (re-syncs backlinks)     |

Every notebook-scoped route verifies the notebook belongs to the authenticated
user before doing anything.
