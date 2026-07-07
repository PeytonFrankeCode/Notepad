-- Notepad schema for Cloudflare D1 (SQLite).
-- Apply locally:  npx wrangler d1 execute notepad-db --local  --file=./schema.sql
-- Apply remotely: npx wrangler d1 execute notepad-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notebooks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  notebook_id INTEGER NOT NULL,
  title       TEXT NOT NULL,
  title_lower TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  is_daily    INTEGER NOT NULL DEFAULT 0,
  daily_date  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(notebook_id, title_lower)
);

-- One row per [[wiki link]] occurrence, scoped to a notebook so backlinks
-- are never shared across notebooks.
CREATE TABLE IF NOT EXISTS links (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  notebook_id        INTEGER NOT NULL,
  source_page_id     INTEGER NOT NULL,
  target_title       TEXT NOT NULL,
  target_title_lower TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id);
CREATE INDEX IF NOT EXISTS idx_pages_notebook ON pages(notebook_id);
CREATE INDEX IF NOT EXISTS idx_pages_daily    ON pages(notebook_id, is_daily, daily_date);
CREATE INDEX IF NOT EXISTS idx_links_target   ON links(notebook_id, target_title_lower);
CREATE INDEX IF NOT EXISTS idx_links_source   ON links(source_page_id);
