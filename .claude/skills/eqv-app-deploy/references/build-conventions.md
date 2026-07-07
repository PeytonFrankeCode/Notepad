# App conventions (build to these and it deploys like all the others)

Any app that follows these runs under the same one-folder / one-service / one-port
pattern and reuses the operations in `deploy-windows.md` and `operations.md`
verbatim.

## Required of every app

1. **Config from a `.env` file** in the app root, loaded at startup; real
   environment variables override it. Never hardcode secrets. Standard keys:

   | Key | Purpose |
   | --- | --- |
   | `HOST` | interface to bind — use `0.0.0.0` |
   | `PORT` | the app's **assigned unique port** (see the port registry) |
   | `DB_PATH` / data dir | absolute path **outside** the code, e.g. `C:\<app>\data\...` |
   | a session/secret key | e.g. `JWT_SECRET` — a long random string, kept stable |

2. **Bind `HOST=0.0.0.0`** and listen on `PORT`.
3. **Persist data outside the code folder** (e.g. `C:\<app>\data\`) so code
   updates never delete it. Create the folder on boot if missing.
4. **`GET /healthz` → 200 JSON** (e.g. `{"ok":true}`) for checks + service health.
5. **Own authentication.** VPN/LAN is the outer gate; the app still has real login.
6. **Runs as a single long-lived process** started by one command
   (e.g. `node server/index.js`). No interactive prompts at startup.
7. **Reverse-proxy ready** (so clean URLs can be added later with zero app
   changes): trust a front proxy's `X-Forwarded-Proto`/`X-Forwarded-For`, and set
   cookies `Secure` when the request is HTTPS. Keep asset/API paths working when
   the app is mounted at a sub-path if you can (or plan for host-based routing).

## Default stack (matches what's installed)

Node.js is already on the server, so the path of least resistance is:

- **Node.js + Express** (or any Node HTTP framework) for the API + serving the UI.
- **SQLite via `better-sqlite3`** for storage — a single file under the data dir,
  zero external DB to run, and it installs a **prebuilt** binary on Windows.
- **`dotenv`** to load `.env`. Load it *before* any module reads `process.env`
  (import an `env.js` first).
- Password hashing (`bcryptjs`) + signed cookie sessions (`jsonwebtoken`) if the
  app has accounts.

Other stacks work too (anything that can run as one Windows process on a port),
but Node needs no extra runtime install. If a stack needs a runtime that isn't on
the server, that's new setup — note it and install it once, then record it here.

## Minimal reference shape (Node example)

```
<app>/
├── package.json          # "start": "node server/index.js"; deps only
├── server/
│   ├── env.js            # imports dotenv, loads ../.env  (import first)
│   ├── index.js          # express app; GET /healthz; listen(PORT, HOST)
│   └── db.js             # opens SQLite at DB_PATH; creates tables on boot
├── public/               # static frontend (served at /)
└── .env                  # created on the server, NOT committed (gitignore it)
```

`.gitignore` should exclude `node_modules/`, `.env`, and the data dir.
