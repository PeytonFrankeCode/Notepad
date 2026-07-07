// SQLite storage for the self-hosted (Node) deployment. All data lives in a
// single file on your server — nothing leaves your network.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, '..', 'data', 'notepad.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notebooks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    title_lower TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    is_daily    INTEGER NOT NULL DEFAULT 0,
    daily_date  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(notebook_id, title_lower)
  );
  CREATE TABLE IF NOT EXISTS links (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    notebook_id        INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    source_page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_title       TEXT NOT NULL,
    target_title_lower TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id);
  CREATE INDEX IF NOT EXISTS idx_pages_notebook ON pages(notebook_id);
  CREATE INDEX IF NOT EXISTS idx_pages_daily    ON pages(notebook_id, is_daily, daily_date);
  CREATE INDEX IF NOT EXISTS idx_links_target   ON links(notebook_id, target_title_lower);
  CREATE INDEX IF NOT EXISTS idx_links_source   ON links(source_page_id);
`);

export default db;
