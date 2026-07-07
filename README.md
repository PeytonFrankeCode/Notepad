# 📓 Notepad

A [Reflect](https://reflect.app)-style notetaking app: a **continuous daily
log**, wiki-style **`[[backlinks]]`** with nested-bullet context, **rich text**,
private **accounts**, and fully **isolated notebooks** — notebooks never share
backlinks.

It ships with **two deployment targets from one codebase**:

- **Self-hosted** (`server/`) — Node + Express + SQLite. Runs on your own server,
  keeps all data on-prem, and is ideal for **VPN-only / internal** access.
- **Cloudflare** (`functions/`) — Pages + Functions + D1, for cloud hosting with
  automatic preview deployments.

The frontend in `public/` is identical for both.

## Features

- **Continuous daily log** — Daily Notes is one running timeline. Today is
  created automatically and opens ready to type — you never title a page for a
  day. Earlier days load on demand.
- **Rich text** — `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `#` headings,
  nested bullets. Toolbar + shortcuts (Ctrl/Cmd+B / +I), smart list continuation
  (Enter), Tab / Shift+Tab to indent.
- **`[[wiki links]]` + backlinks** — type `[[Page]]` (with autocomplete). Open a
  page to see its **Linked references**, and any bullets **nested under** a link
  are pulled in with it.
- **Accounts** — email + password; each user's space is private and syncs across
  their devices. Passwords are hashed (bcrypt on Node / PBKDF2 on Cloudflare);
  sessions are a signed JWT in an httpOnly cookie.
- **Notebooks** — separate notebooks per user, each with its **own daily log,
  pages, and backlink graph**.

---

## Deploy on your own server (VPN-only)

The app itself does not run the VPN — access control happens at the **network
layer**. You bind the app to an internal interface and let your firewall/VPN
decide who can reach it; the built-in login is then a second layer.

### Quick start (bare Node)

```bash
npm ci --omit=dev
export JWT_SECRET="$(openssl rand -hex 32)"   # keep this stable & secret
export HOST=10.8.0.5     # your VPN/LAN address (or 127.0.0.1 behind a proxy)
export PORT=3000
npm start                # -> http://10.8.0.5:3000
```

Sign up (a starter "My Notes" notebook is created) and start writing. Data is a
single SQLite file at `DB_PATH` (default `./data/notepad.sqlite`) — back it up.

### Run as a service (systemd)

See [`deploy/notepad.service`](deploy/notepad.service) — copy it to
`/etc/systemd/system/`, set `JWT_SECRET`/`HOST`, then
`systemctl enable --now notepad`.

### Run with Docker

```bash
cp .env.example .env      # set JWT_SECRET (openssl rand -hex 32)
docker compose up -d      # binds to 127.0.0.1:3000 by default
```

Edit the `ports:` line in `docker-compose.yml` to bind your VPN address (e.g.
`10.8.0.5:3000:3000`).

### Making it VPN-only + adding TLS

1. **Bind to the internal interface** — set `HOST` (or the compose `ports:`
   mapping) to your VPN/LAN IP, or to `127.0.0.1` if a reverse proxy on the same
   host fronts it. Don't bind `0.0.0.0` on a public interface.
2. **Firewall** — allow the app's port only from your VPN subnet.
3. **TLS (recommended, even internally)** — terminate HTTPS with nginx/Caddy in
   front (see [`deploy/nginx.conf.example`](deploy/nginx.conf.example)). The app
   reads `X-Forwarded-Proto` (with `TRUST_PROXY` set) and marks the session
   cookie `Secure` automatically. Over plain HTTP on an internal network the
   cookie is non-Secure so login still works.

### Server configuration

| Variable        | Default                 | Purpose                                                        |
| --------------- | ----------------------- | -------------------------------------------------------------- |
| `JWT_SECRET`    | random per start        | **Set this** so sessions survive restarts. Keep it secret.     |
| `HOST`          | `0.0.0.0`               | Interface to bind — set to your VPN/LAN IP or `127.0.0.1`.     |
| `PORT`          | `3000`                  | Port to listen on.                                             |
| `DB_PATH`       | `./data/notepad.sqlite` | SQLite database file location.                                 |
| `COOKIE_SECURE` | auto                    | Force `Secure` cookies. Usually left to auto-detect via proxy. |
| `TRUST_PROXY`   | `loopback`              | Express trust-proxy value when behind a reverse proxy.         |

---

## Deploy on Cloudflare

Provide your **D1 database id**, a **`JWT_SECRET`**, and a **Pages project**.

```bash
npm install
npx wrangler login
npx wrangler d1 create notepad-db      # paste the id into wrangler.toml
npm run cf:db:remote                   # applies schema.sql to your D1
```

Then either connect the repo in the Cloudflare dashboard (**Pages → Connect to
Git**, build output dir `public`, add a `DB` D1 binding and a `JWT_SECRET` env
var) for automatic preview deployments, or deploy from the CLI:

```bash
npx wrangler pages secret put JWT_SECRET
npm run cf:deploy
```

Local Cloudflare dev: `npm run cf:db:local && echo 'JWT_SECRET=dev' > .dev.vars && npm run cf:dev`.

---

## Architecture

```
public/                 shared static frontend
├── js/app.js           UI: auth, daily log, pages, sidebar
├── js/editor.js        rich-text editor: toolbar, shortcuts, lists, [[ autocomplete
├── js/util.js          note renderer (markdown-lite + [[links]] + bullets)
└── js/api.js           fetch client (same-origin /api)

server/                 self-hosted target — Express + better-sqlite3
functions/api/[[path]].js   Cloudflare target — Hono + D1
schema.sql              D1 schema  (Node build creates its tables on boot)
```

- A **page** is any note with a title; daily entries are date-titled pages.
- On save, a page's `[[links]]` are parsed into a `links` table **scoped to its
  notebook** — which is what makes notebooks perfectly isolated.
- A backlink's context is the line mentioning the link **plus every line nested
  beneath it**, so bulleted detail travels with the reference.
