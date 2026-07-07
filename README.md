# 📓 Notepad

A [Reflect](https://reflect.app)-style notetaking app: a **continuous daily
log**, wiki-style **`[[backlinks]]`** with nested-bullet context, **rich text**,
private **accounts**, and fully **isolated notebooks** — notebooks never share
backlinks.

Runs on **Cloudflare Pages + Functions + D1** — a static frontend, a real API,
and a real (SQLite) database, all on one platform, with automatic preview
deployments for review.

## Features

- **Continuous daily log** — the Daily Notes view is one running timeline. Today
  is created automatically and opens ready to type — you never title a page for a
  day. Earlier days load on demand.
- **Rich text** — `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `#` headings,
  and nested bullets. A formatting toolbar plus shortcuts (Ctrl/Cmd+B / +I),
  smart list continuation (Enter), and Tab / Shift+Tab to indent/outdent.
- **`[[wiki links]]` + backlinks** — type `[[Page]]` (with autocomplete) to link.
  Open a page to see its **Linked references** — and any bullet points **nested
  under** a link are pulled in with it.
- **Accounts** — email + password sign-up/login. Passwords are hashed with
  PBKDF2 (Web Crypto); sessions are a signed JWT in an httpOnly cookie. Each
  user's space is completely private and syncs across devices.
- **Notebooks** — separate notebooks per user, each with its **own daily log,
  pages, and backlink graph**. A `[[Project]]` link in one notebook is entirely
  independent of the same name in another.

## Architecture

```
public/                 static frontend (Cloudflare Pages serves this)
├── index.html
├── css/styles.css
└── js/{app,api,editor,util}.js
functions/
└── api/[[path]].js     the API (Hono) on the Workers runtime, backed by D1
schema.sql              D1 (SQLite) schema
wrangler.toml           Pages + D1 configuration
```

- A **page** is any note with a title. Daily entries are pages whose title is the
  ISO date (`is_daily = 1`), shown as "Monday, July 7, 2026".
- On save, a page's `[[links]]` are parsed into a `links` table **scoped to its
  notebook**, which is what makes notebooks perfectly isolated.
- A backlink's context is the line that mentions the link **plus every line
  nested beneath it**, so bulleted detail travels with the reference.

## Deploying to Cloudflare

You provide three things: your **D1 database id**, a **`JWT_SECRET`**, and a
**Pages project** (name/domain). Pick either path below.

### One required edit

Create the database and paste its id into `wrangler.toml`:

```bash
npm install
npx wrangler login
npx wrangler d1 create notepad-db      # copy the printed database_id
```

Put that id in `wrangler.toml` → `[[d1_databases]] database_id = "…"`, then
create the tables:

```bash
npm run db:remote                      # applies schema.sql to your D1
```

### Path A — Dashboard (recommended; auto preview deployments)

1. **Workers & Pages → Create → Pages → Connect to Git**, pick this repo/branch.
2. Build settings: **Framework preset: None**, **Build output directory: `public`**
   (leave the build command empty — Functions in `/functions` are detected
   automatically).
3. **Settings → Functions → D1 bindings**: add variable **`DB`** → `notepad-db`.
4. **Settings → Environment variables**: add **`JWT_SECRET`** = a long random
   string (add it to *Production* **and** *Preview*).
5. Redeploy. Every push now gets its own preview URL for review.

### Path B — CLI (Wrangler)

```bash
npx wrangler pages secret put JWT_SECRET   # paste a long random value
npm run deploy                             # wrangler pages deploy
```

## Local development

```bash
npm install
npm run db:local        # create + migrate a local D1
echo 'JWT_SECRET=local-dev-secret' > .dev.vars
npm run dev             # wrangler pages dev  → http://localhost:8788
```

Sign up (a starter "My Notes" notebook is created for you) and start writing.

### Configuration

| Setting      | Where                         | Purpose                                    |
| ------------ | ----------------------------- | ------------------------------------------ |
| `DB`         | D1 binding (wrangler / dash)  | The SQLite database                        |
| `JWT_SECRET` | secret / env var              | Signs session tokens — keep it private     |
| `database_id`| `wrangler.toml`               | Which D1 database to use                    |
