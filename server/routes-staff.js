const express = require('express');
const { db, getSetting, setSetting } = require('./db');
const { SA_PROVINCES } = require('./constants');
const {
  verifyLogin,
  createUser,
  listUsers,
  deleteUser,
  resetUserPin,
  requireStaff,
  requireAdmin,
} = require('./auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, pin } = req.body || {};
  const user = verifyLogin(username, pin);
  if (!user) return res.status(401).json({ error: 'Incorrect username or PIN.' });
  req.session.role = user.role;
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, role: user.role, username: user.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/session', (req, res) => {
  const role = (req.session && req.session.role) || null;
  res.json({ loggedIn: !!role, role, username: (req.session && req.session.username) || null });
});

router.use(requireStaff);

// ---- Attendees ----
// GET (search), POST (add walk-in) and the check-in toggle are available to
// both check-in volunteers and admins. Full edit, delete and export are
// admin-only.

router.get('/attendees', (req, res) => {
  const { search, province, checked_in, origin_type } = req.query;
  let sql = 'SELECT * FROM attendees WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR assembly LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (province) { sql += ' AND province = ?'; params.push(province); }
  if (origin_type) { sql += ' AND origin_type = ?'; params.push(origin_type); }
  if (checked_in === '0' || checked_in === '1') { sql += ' AND checked_in = ?'; params.push(Number(checked_in)); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/attendees', (req, res) => {
  const b = req.body || {};
  const fullName = (b.fullName || '').trim();
  const originType = b.originType === 'international' ? 'international' : 'province';
  if (!fullName) return res.status(400).json({ error: 'Full name is required.' });
  if (originType === 'province' && !SA_PROVINCES.includes(b.province)) {
    return res.status(400).json({ error: 'Please select a valid province.' });
  }

  const stmt = db.prepare(`
    INSERT INTO attendees
      (full_name, phone, email, origin_type, province, country, assembly,
       num_adults, num_children, arrival_date, departure_date, accommodation, notes,
       registered_by, checked_in, checked_in_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff', ?, ?)
  `);
  const checkedIn = b.checkedIn ? 1 : 0;
  const result = stmt.run(
    fullName,
    (b.phone || '').trim() || null,
    (b.email || '').trim() || null,
    originType,
    originType === 'province' ? b.province : null,
    originType === 'international' ? (b.country || '').trim() : null,
    (b.assembly || '').trim() || null,
    Math.max(1, parseInt(b.numAdults, 10) || 1),
    Math.max(0, parseInt(b.numChildren, 10) || 0),
    b.arrivalDate || null,
    b.departureDate || null,
    (b.accommodation || '').trim() || null,
    (b.notes || '').trim() || null,
    checkedIn,
    checkedIn ? new Date().toISOString() : null
  );
  res.status(201).json(db.prepare('SELECT * FROM attendees WHERE id = ?').get(result.lastInsertRowid));
});

router.post('/attendees/:id/checkin', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM attendees WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Attendee not found.' });
  const checkedIn = !!(req.body || {}).checkedIn;
  db.prepare('UPDATE attendees SET checked_in = ?, checked_in_at = ? WHERE id = ?').run(
    checkedIn ? 1 : 0,
    checkedIn ? new Date().toISOString() : null,
    id
  );
  res.json(db.prepare('SELECT * FROM attendees WHERE id = ?').get(id));
});

router.patch('/attendees/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM attendees WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Attendee not found.' });

  const b = req.body || {};
  const fields = [];
  const params = [];
  const setIf = (col, val) => { if (val !== undefined) { fields.push(`${col} = ?`); params.push(val); } };

  setIf('full_name', b.fullName !== undefined ? String(b.fullName).trim() : undefined);
  setIf('phone', b.phone !== undefined ? String(b.phone).trim() || null : undefined);
  setIf('email', b.email !== undefined ? String(b.email).trim() || null : undefined);
  setIf('assembly', b.assembly !== undefined ? String(b.assembly).trim() || null : undefined);
  setIf('accommodation', b.accommodation !== undefined ? String(b.accommodation).trim() || null : undefined);
  setIf('notes', b.notes !== undefined ? String(b.notes).trim() || null : undefined);
  setIf('arrival_date', b.arrivalDate !== undefined ? (b.arrivalDate || null) : undefined);
  setIf('departure_date', b.departureDate !== undefined ? (b.departureDate || null) : undefined);
  setIf('num_adults', b.numAdults !== undefined ? Math.max(1, parseInt(b.numAdults, 10) || 1) : undefined);
  setIf('num_children', b.numChildren !== undefined ? Math.max(0, parseInt(b.numChildren, 10) || 0) : undefined);

  if (b.checkedIn !== undefined) {
    fields.push('checked_in = ?', 'checked_in_at = ?');
    params.push(b.checkedIn ? 1 : 0, b.checkedIn ? new Date().toISOString() : null);
  }

  if (!fields.length) return res.json(existing);
  params.push(id);
  db.prepare(`UPDATE attendees SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM attendees WHERE id = ?').get(id));
});

router.delete('/attendees/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM attendees WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

router.get('/attendees-export.csv', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM attendees ORDER BY created_at').all();
  const cols = [
    'id', 'full_name', 'phone', 'email', 'origin_type', 'province', 'country', 'assembly',
    'num_adults', 'num_children', 'arrival_date', 'departure_date', 'accommodation', 'notes',
    'registered_by', 'checked_in', 'checked_in_at', 'created_at',
  ];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="attendees.csv"');
  res.send(csv);
});

// ---- Teams (admin-only) ----

router.post('/teams', requireAdmin, (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  const category = (b.category || '').trim();
  if (!name || !category) return res.status(400).json({ error: 'Team name and category are required.' });
  const result = db
    .prepare('INSERT INTO teams (name, category, province, color, notes) VALUES (?, ?, ?, ?, ?)')
    .run(name, category, (b.province || '').trim() || null, b.color || '#C68A2E', (b.notes || '').trim() || null);
  res.status(201).json(db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/teams/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Team not found.' });
  const b = req.body || {};
  const fields = [];
  const params = [];
  const setIf = (col, val) => { if (val !== undefined) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('name', b.name !== undefined ? String(b.name).trim() : undefined);
  setIf('category', b.category !== undefined ? String(b.category).trim() : undefined);
  setIf('province', b.province !== undefined ? (String(b.province).trim() || null) : undefined);
  setIf('color', b.color !== undefined ? b.color : undefined);
  setIf('notes', b.notes !== undefined ? (String(b.notes).trim() || null) : undefined);
  if (!fields.length) return res.json(existing);
  params.push(id);
  db.prepare(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM teams WHERE id = ?').get(id));
});

router.delete('/teams/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM teams WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Duties (admin-only) ----

router.post('/duties', requireAdmin, (req, res) => {
  const b = req.body || {};
  const teamId = Number(b.teamId);
  const dutyDate = b.dutyDate;
  const task = (b.task || '').trim();
  if (!teamId || !dutyDate || !task) {
    return res.status(400).json({ error: 'Team, date and task are required.' });
  }
  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(400).json({ error: 'Unknown team.' });
  const result = db
    .prepare('INSERT INTO duties (team_id, duty_date, task, notes) VALUES (?, ?, ?, ?)')
    .run(teamId, dutyDate, task, (b.notes || '').trim() || null);
  const row = db
    .prepare(`
      SELECT d.*, t.name AS team_name, t.category AS team_category, t.province AS team_province, t.color AS team_color
      FROM duties d JOIN teams t ON t.id = d.team_id WHERE d.id = ?
    `)
    .get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.patch('/duties/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM duties WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Duty not found.' });
  const b = req.body || {};
  const fields = [];
  const params = [];
  const setIf = (col, val) => { if (val !== undefined) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('team_id', b.teamId !== undefined ? Number(b.teamId) : undefined);
  setIf('duty_date', b.dutyDate !== undefined ? b.dutyDate : undefined);
  setIf('task', b.task !== undefined ? String(b.task).trim() : undefined);
  setIf('notes', b.notes !== undefined ? (String(b.notes).trim() || null) : undefined);
  if (!fields.length) return res.json(existing);
  params.push(id);
  db.prepare(`UPDATE duties SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM duties WHERE id = ?').get(id));
});

router.delete('/duties/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM duties WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Settings (admin-only) ----

router.get('/settings', requireAdmin, (req, res) => {
  res.json({
    event_name: getSetting('event_name', ''),
    event_location: getSetting('event_location', ''),
    event_start: getSetting('event_start', ''),
    event_end: getSetting('event_end', ''),
  });
});

router.post('/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  ['event_name', 'event_location', 'event_start', 'event_end'].forEach((key) => {
    if (b[key] !== undefined) setSetting(key, String(b[key]));
  });
  res.json({ ok: true });
});

// ---- Staff accounts (admin-only) ----

router.get('/users', requireAdmin, (req, res) => {
  res.json(listUsers());
});

router.post('/users', requireAdmin, (req, res) => {
  const { username, pin, role } = req.body || {};
  try {
    const user = createUser(username, pin, role);
    res.status(201).json(user);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/users/:id/reset-pin', requireAdmin, (req, res) => {
  const { newPin } = req.body || {};
  try {
    resetUserPin(Number(req.params.id), newPin);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.delete('/users/:id', requireAdmin, (req, res) => {
  try {
    deleteUser(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
