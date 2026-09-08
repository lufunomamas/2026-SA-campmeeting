const bcrypt = require('bcryptjs');
const { db } = require('./db');

const DEFAULT_USERNAME = process.env.ADMIN_USERNAME || 'lufunom';
const DEFAULT_PIN = process.env.ADMIN_PIN || '3698';

function ensureDefaultAdminSeeded() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count === 0) {
    createUser(DEFAULT_USERNAME, DEFAULT_PIN, 'admin');
  }
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function createUser(username, pin, role) {
  const uname = normalizeUsername(username);
  if (!uname) throw Object.assign(new Error('Username is required.'), { status: 400 });
  if (!pin || String(pin).length < 4) {
    throw Object.assign(new Error('PIN must be at least 4 characters.'), { status: 400 });
  }
  if (role !== 'admin' && role !== 'checkin') {
    throw Object.assign(new Error('Role must be admin or checkin.'), { status: 400 });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (existing) throw Object.assign(new Error('That username is already taken.'), { status: 409 });

  const result = db
    .prepare('INSERT INTO users (username, pin_hash, role) VALUES (?, ?, ?)')
    .run(uname, bcrypt.hashSync(String(pin), 10), role);
  return db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function listUsers() {
  return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at').all();
}

function deleteUser(id) {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return;
  if (target.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) {
      throw Object.assign(new Error('Cannot delete the last remaining admin account.'), { status: 400 });
    }
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function resetUserPin(id, newPin) {
  if (!newPin || String(newPin).length < 4) {
    throw Object.assign(new Error('PIN must be at least 4 characters.'), { status: 400 });
  }
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPin), 10), id);
}

/** Returns the user row ({id, username, role}) on success, or null. */
function verifyLogin(username, pin) {
  const uname = normalizeUsername(username);
  if (!uname || !pin) return null;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  if (!user) return null;
  if (!bcrypt.compareSync(String(pin), user.pin_hash)) return null;
  return { id: user.id, username: user.username, role: user.role };
}

/** Any signed-in staff member — check-in volunteer or admin. */
function requireStaff(req, res, next) {
  if (req.session && req.session.role) return next();
  return res.status(401).json({ error: 'Staff login required.' });
}

/** Admins only — team/roster/settings management, edits, deletes, exports. */
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required.' });
}

module.exports = {
  ensureDefaultAdminSeeded,
  verifyLogin,
  createUser,
  listUsers,
  deleteUser,
  resetUserPin,
  requireStaff,
  requireAdmin,
  DEFAULT_USERNAME,
  DEFAULT_PIN,
};
