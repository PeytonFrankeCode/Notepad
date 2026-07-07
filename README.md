# 📓 Notepad

A self-hosted, [Reflect](https://reflect.app)-style notetaking app: a
**continuous daily log**, wiki-style **`[[backlinks]]`** with nested-bullet
context, **rich text**, private **accounts**, and fully **isolated notebooks** —
notebooks never share backlinks.

Runs as a small **Node + Express + SQLite** server on your own machine. All data
stays in one SQLite file on your box — ideal for hosting behind a VPN.

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
  their devices. Passwords are bcrypt-hashed; sessions are a signed JWT in an
  httpOnly cookie.
- **Notebooks** — separate notebooks per user, each with its **own daily log,
  pages, and backlink graph**.

## Run it

### With Docker (recommended)

```bash
cp .env.example .env          # then edit JWT_SECRET (openssl rand -hex 32)
docker compose up -d          # binds to 127.0.0.1:3000 by default
```

Point the `ports:` line in `docker-compose.yml` at your VPN address to expose it
to VPN clients (e.g. `10.0.0.1:3000:3000`).

### With Node directly

```bash
npm ci --omit=dev
export JWT_SECRET="$(openssl rand -hex 32)"   # keep this stable & secret
export HOST=10.0.0.1   # your VPN/LAN address (or 127.0.0.1 behind a proxy)
export PORT=3000
npm start
```

To run it as a boot service, see [`deploy/notepad.service`](deploy/notepad.service).

Then open the app, click **Sign up** (a starter "My Notes" notebook is created),
and start writing.

## Hosting it behind a VPN

The app doesn't run the VPN — access is enforced at the network layer:

1. **Bind to an internal interface** — set `HOST` (or the compose `ports:`
   mapping) to your VPN address, or `127.0.0.1` if a reverse proxy on the same
   host fronts it. Don't bind `0.0.0.0` on a public interface.
2. **Firewall** the port to your VPN subnet.
3. **TLS (recommended)** — terminate HTTPS with nginx/Caddy in front (see
   [`deploy/nginx.conf.example`](deploy/nginx.conf.example)). The app reads
   `X-Forwarded-Proto` (with `TRUST_PROXY` set) and marks the session cookie
   `Secure` automatically. Over plain internal HTTP the cookie is non-Secure so
   login still works.

There's a full step-by-step WireGuard walkthrough in [`DEPLOY.md`](DEPLOY.md).

## Configuration

| Variable        | Default                 | Purpose                                                        |
| --------------- | ----------------------- | -------------------------------------------------------------- |
| `JWT_SECRET`    | random per start        | **Set this** so sessions survive restarts. Keep it secret.     |
| `HOST`          | `0.0.0.0`               | Interface to bind — set to your VPN/LAN IP or `127.0.0.1`.     |
| `PORT`          | `3000`                  | Port to listen on.                                             |
| `DB_PATH`       | `./data/notepad.sqlite` | SQLite database file location.                                 |
| `COOKIE_SECURE` | auto                    | Force `Secure` cookies. Usually left to auto-detect via proxy. |
| `TRUST_PROXY`   | `loopback`              | Express trust-proxy value when behind a reverse proxy.         |

## Architecture

```
public/                 static frontend
├── js/app.js           UI: auth, daily log, pages, sidebar
├── js/editor.js        rich-text editor: toolbar, shortcuts, lists, [[ autocomplete
├── js/util.js          note renderer (markdown-lite + [[links]] + bullets)
└── js/api.js           fetch client (same-origin /api)
server/                 Express API + better-sqlite3 (tables created on boot)
deploy/                 systemd unit + nginx TLS example
Dockerfile, docker-compose.yml
```

- A **page** is any note with a title; daily entries are date-titled pages.
- On save, a page's `[[links]]` are parsed into a `links` table **scoped to its
  notebook** — which is what makes notebooks perfectly isolated.
- A backlink's context is the line mentioning the link **plus every line nested
  beneath it**, so bulleted detail travels with the reference.
