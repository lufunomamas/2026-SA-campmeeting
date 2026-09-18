const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'church.db');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  origin_type TEXT NOT NULL CHECK (origin_type IN ('province','international')),
  province TEXT,
  country TEXT,
  assembly TEXT,
  num_adults INTEGER NOT NULL DEFAULT 1,
  num_children INTEGER NOT NULL DEFAULT 0,
  arrival_date TEXT,
  departure_date TEXT,
  accommodation TEXT,
  notes TEXT,
  registered_by TEXT NOT NULL DEFAULT 'self' CHECK (registered_by IN ('self','staff')),
  checked_in INTEGER NOT NULL DEFAULT 0,
  checked_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  province TEXT,
  color TEXT NOT NULL DEFAULT '#C68A2E',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS duties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  duty_date TEXT NOT NULL,
  task TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','department_admin','checkin')),
  division_id INTEGER REFERENCES divisions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS divisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  head_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subcommittees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  division_id INTEGER NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcommittee_id INTEGER NOT NULL REFERENCES subcommittees(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  approved_budget REAL NOT NULL DEFAULT 0,
  manual_disbursed REAL NOT NULL DEFAULT 0,
  manual_refunded REAL NOT NULL DEFAULT 0,
  UNIQUE(subcommittee_id, year)
);

CREATE TABLE IF NOT EXISTS requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requestor_name TEXT NOT NULL,
  requestor_contact TEXT NOT NULL,
  subcommittee_id INTEGER NOT NULL REFERENCES subcommittees(id),
  description TEXT NOT NULL,
  recommended_vendor TEXT,
  amount_requested REAL NOT NULL,
  date_required TEXT,
  priority TEXT NOT NULL DEFAULT '3',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash','Bank','Cash Send')),
  banking_details TEXT,
  payment_reference TEXT,
  proof_of_payment_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','review')),
  reviewer_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attendees_province ON attendees(province);
CREATE INDEX IF NOT EXISTS idx_attendees_checked_in ON attendees(checked_in);
CREATE INDEX IF NOT EXISTS idx_duties_date ON duties(duty_date);
CREATE INDEX IF NOT EXISTS idx_duties_team ON duties(team_id);
CREATE INDEX IF NOT EXISTS idx_subcommittees_division ON subcommittees(division_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_year ON budget_lines(year);
CREATE INDEX IF NOT EXISTS idx_requisitions_status ON requisitions(status);
CREATE INDEX IF NOT EXISTS idx_requisitions_subcommittee ON requisitions(subcommittee_id);
`);

// Migrate older `users` tables (created before department_admin/division_id
// existed) by rebuilding the table with the new schema and copying rows over.
const userCols = db.prepare('PRAGMA table_info(users)').all();
if (!userCols.some((c) => c.name === 'division_id')) {
  db.exec(`
    ALTER TABLE users RENAME TO users_old_migrate;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      pin_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','department_admin','checkin')),
      division_id INTEGER REFERENCES divisions(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, username, pin_hash, role, created_at)
      SELECT id, username, pin_hash, role, created_at FROM users_old_migrate;
    DROP TABLE users_old_migrate;
  `);
}

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

module.exports = { db, getSetting, setSetting };
