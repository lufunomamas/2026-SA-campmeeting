const bcrypt = require('bcryptjs');
const { db } = require('./db');

const DEFAULT_USERNAME = process.env.ADMIN_USERNAME || 'lufunom';
const DEFAULT_PIN = process.env.ADMIN_PIN || '3698';
const ROLES = ['admin', 'department_admin', 'checkin'];

function ensureDefaultAdminSeeded() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count === 0) {
    createUser(DEFAULT_USERNAME, DEFAULT_PIN, 'admin', null);
  }
  // The very first admin account is the app owner: no other super admin can
  // delete or modify it, regardless of how many admins exist. Idempotent, and
  // re-applied on every boot so it also protects an account that already
  // existed before this protection was introduced.
  db.prepare('UPDATE users SET protected = 1 WHERE username = ?').run(normalizeUsername(DEFAULT_USERNAME));
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function createUser(username, pin, role, divisionId) {
  const uname = normalizeUsername(username);
  if (!uname) throw Object.assign(new Error('Username is required.'), { status: 400 });
  if (!pin || String(pin).length < 4) {
    throw Object.assign(new Error('PIN must be at least 4 characters.'), { status: 400 });
  }
  if (!ROLES.includes(role)) {
    throw Object.assign(new Error('Role must be admin, department_admin, or checkin.'), { status: 400 });
  }
  const divId = validateDivisionForRole(role, divisionId);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (existing) throw Object.assign(new Error('That username is already taken.'), { status: 409 });

  const result = db
    .prepare('INSERT INTO users (username, pin_hash, role, division_id) VALUES (?, ?, ?, ?)')
    .run(uname, bcrypt.hashSync(String(pin), 10), role, divId);
  return getUserById(result.lastInsertRowid);
}

function validateDivisionForRole(role, divisionId) {
  if (role !== 'department_admin') return null;
  const id = Number(divisionId);
  if (!id) throw Object.assign(new Error('A division is required for department admin accounts.'), { status: 400 });
  const division = db.prepare('SELECT id FROM divisions WHERE id = ?').get(id);
  if (!division) throw Object.assign(new Error('Unknown division.'), { status: 400 });
  return id;
}

/** Throws if `target` is a protected (owner) account and the acting user is
 * someone else. The owner may still act on their own account. */
function assertNotProtectedByOther(target, actingUserId) {
  if (target.protected && target.id !== actingUserId) {
    throw Object.assign(
      new Error(`This account is protected — only ${target.username} can change it.`),
      { status: 403 }
    );
  }
}

function getUserById(id) {
  return db
    .prepare(`
      SELECT u.id, u.username, u.role, u.division_id, d.name AS division_name, u.protected, u.created_at
      FROM users u LEFT JOIN divisions d ON d.id = u.division_id
      WHERE u.id = ?
    `)
    .get(id);
}

function listUsers() {
  return db
    .prepare(`
      SELECT u.id, u.username, u.role, u.division_id, d.name AS division_name, u.protected, u.created_at
      FROM users u LEFT JOIN divisions d ON d.id = u.division_id
      ORDER BY u.created_at
    `)
    .all();
}

function updateUser(id, { role, divisionId }, actingUserId) {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw Object.assign(new Error('Account not found.'), { status: 404 });
  assertNotProtectedByOther(target, actingUserId);

  const nextRole = role !== undefined ? role : target.role;
  if (!ROLES.includes(nextRole)) {
    throw Object.assign(new Error('Role must be admin, department_admin, or checkin.'), { status: 400 });
  }
  if (target.role === 'admin' && nextRole !== 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) {
      throw Object.assign(new Error('Cannot change the role of the last remaining admin account.'), { status: 400 });
    }
  }
  const divId = validateDivisionForRole(nextRole, divisionId !== undefined ? divisionId : target.division_id);
  db.prepare('UPDATE users SET role = ?, division_id = ? WHERE id = ?').run(nextRole, divId, id);
  return getUserById(id);
}

function deleteUser(id, actingUserId) {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return;
  assertNotProtectedByOther(target, actingUserId);
  if (target.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) {
      throw Object.assign(new Error('Cannot delete the last remaining admin account.'), { status: 400 });
    }
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function resetUserPin(id, newPin, actingUserId) {
  if (!newPin || String(newPin).length < 4) {
    throw Object.assign(new Error('PIN must be at least 4 characters.'), { status: 400 });
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw Object.assign(new Error('Account not found.'), { status: 404 });
  assertNotProtectedByOther(target, actingUserId);
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPin), 10), id);
}

/** Returns the user row ({id, username, role, division_id}) on success, or null. */
function verifyLogin(username, pin) {
  const uname = normalizeUsername(username);
  if (!uname || !pin) return null;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  if (!user) return null;
  if (!bcrypt.compareSync(String(pin), user.pin_hash)) return null;
  return { id: user.id, username: user.username, role: user.role, divisionId: user.division_id };
}

/** Any signed-in staff member — check-in volunteer, department admin, or admin. */
function requireStaff(req, res, next) {
  if (req.session && req.session.role) return next();
  return res.status(401).json({ error: 'Staff login required.' });
}

/** Full admins only — team/roster/settings management, staff accounts, full exports/imports. */
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required.' });
}

/** Admins or department admins — requisitions/budget, scoped to their division for the latter. */
function requireRequisitionAccess(req, res, next) {
  if (req.session && (req.session.role === 'admin' || req.session.role === 'department_admin')) return next();
  return res.status(403).json({ error: 'Admin or department admin access required.' });
}

/** Admins or check-in volunteers — attendee check-in. Department admins are scoped to
 * requisitions/budget only and don't get attendee access. */
function requireCheckinAccess(req, res, next) {
  if (req.session && (req.session.role === 'admin' || req.session.role === 'checkin')) return next();
  return res.status(403).json({ error: 'Admin or check-in access required.' });
}

/** null for a full admin (no restriction); the caller's division id otherwise. */
function scopeDivisionId(req) {
  return req.session.role === 'department_admin' ? req.session.divisionId : null;
}

module.exports = {
  ensureDefaultAdminSeeded,
  verifyLogin,
  createUser,
  listUsers,
  updateUser,
  deleteUser,
  resetUserPin,
  requireStaff,
  requireAdmin,
  requireRequisitionAccess,
  requireCheckinAccess,
  scopeDivisionId,
  DEFAULT_USERNAME,
  DEFAULT_PIN,
};
