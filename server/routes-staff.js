const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { db, getSetting, setSetting, dataDir } = require('./db');
const { SA_PROVINCES, REQUISITION_PRIORITIES, PAYMENT_METHODS, REQUISITION_STATUSES } = require('./constants');
const { toCsv, parseCsv } = require('./csv');
const { CURRENT_YEAR } = require('./budget_seed');
const {
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
} = require('./auth');

const router = express.Router();

// Coerces a possibly-null/undefined API value to a trimmed string; String(null)
// would otherwise stringify to the literal text "null" instead of clearing it.
const str = (v) => String(v ?? '').trim();
const nullableStr = (v) => str(v) || null;

const receiptsDir = path.join(dataDir, 'receipts');
fs.mkdirSync(receiptsDir, { recursive: true });
const ALLOWED_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, receiptsDir),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 10)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_RECEIPT_TYPES.has(file.mimetype)),
});
function uploadReceipts(req, res, next) {
  receiptUpload.array('receipts', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}

router.post('/login', (req, res) => {
  const { username, pin } = req.body || {};
  const user = verifyLogin(username, pin);
  if (!user) return res.status(401).json({ error: 'Incorrect username or PIN.' });
  req.session.role = user.role;
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.divisionId = user.divisionId;
  res.json({ ok: true, role: user.role, username: user.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/session', (req, res) => {
  const role = (req.session && req.session.role) || null;
  const divisionId = (req.session && req.session.divisionId) || null;
  const division = divisionId ? db.prepare('SELECT name FROM divisions WHERE id = ?').get(divisionId) : null;
  res.json({
    loggedIn: !!role,
    role,
    username: (req.session && req.session.username) || null,
    divisionId,
    divisionName: division ? division.name : null,
  });
});

router.use(requireStaff);

// ---- Attendees ----
// GET (search), POST (add walk-in) and the check-in toggle are available to
// both check-in volunteers and admins. Full edit, delete and export are
// admin-only.

router.get('/attendees', requireCheckinAccess, (req, res) => {
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

router.post('/attendees', requireCheckinAccess, (req, res) => {
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

router.post('/attendees/:id/checkin', requireCheckinAccess, (req, res) => {
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

  setIf('full_name', b.fullName !== undefined ? str(b.fullName) : undefined);
  setIf('phone', b.phone !== undefined ? nullableStr(b.phone) : undefined);
  setIf('email', b.email !== undefined ? nullableStr(b.email) : undefined);
  setIf('assembly', b.assembly !== undefined ? nullableStr(b.assembly) : undefined);
  setIf('accommodation', b.accommodation !== undefined ? nullableStr(b.accommodation) : undefined);
  setIf('notes', b.notes !== undefined ? nullableStr(b.notes) : undefined);
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
  setIf('name', b.name !== undefined ? str(b.name) : undefined);
  setIf('category', b.category !== undefined ? str(b.category) : undefined);
  setIf('province', b.province !== undefined ? nullableStr(b.province) : undefined);
  setIf('color', b.color !== undefined ? b.color : undefined);
  setIf('notes', b.notes !== undefined ? nullableStr(b.notes) : undefined);
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
  setIf('task', b.task !== undefined ? str(b.task) : undefined);
  setIf('notes', b.notes !== undefined ? nullableStr(b.notes) : undefined);
  if (!fields.length) return res.json(existing);
  params.push(id);
  db.prepare(`UPDATE duties SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM duties WHERE id = ?').get(id));
});

router.delete('/duties/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM duties WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Requisitions ----
// Admins see and manage every requisition. Department admins are scoped to
// their own division only, both for listing and for updating status.

const REQUISITION_SELECT = `
  SELECT r.*, s.name AS subcommittee_name, d.id AS division_id, d.name AS division_name
  FROM requisitions r
  JOIN subcommittees s ON s.id = r.subcommittee_id
  JOIN divisions d ON d.id = s.division_id
`;

// Adds `receipts` (uploaded proof of spend) and `balance` (requested vs. actually
// spent — positive means owed back to the church, negative means owed to the
// requestor, null means usage hasn't been reported yet) to a requisition row.
function attachExtras(row) {
  if (!row) return row;
  row.receipts = db
    .prepare('SELECT id, original_name, uploaded_at FROM requisition_receipts WHERE requisition_id = ? ORDER BY uploaded_at')
    .all(row.id);
  row.balance = row.actual_spent == null ? null : row.amount_requested - row.actual_spent;
  return row;
}

router.get('/requisitions', requireRequisitionAccess, (req, res) => {
  const { status, subcommittee_id, search } = req.query;
  const myDivisionId = scopeDivisionId(req);
  let sql = REQUISITION_SELECT + ' WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND r.status = ?'; params.push(status); }
  if (subcommittee_id) { sql += ' AND r.subcommittee_id = ?'; params.push(subcommittee_id); }
  if (myDivisionId) { sql += ' AND d.id = ?'; params.push(myDivisionId); }
  else if (req.query.division_id) { sql += ' AND d.id = ?'; params.push(req.query.division_id); }
  if (search) {
    sql += ' AND (r.requestor_name LIKE ? OR r.description LIKE ? OR r.recommended_vendor LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY r.created_at DESC';
  res.json(db.prepare(sql).all(...params).map(attachExtras));
});

router.patch('/requisitions/:id', requireRequisitionAccess, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(REQUISITION_SELECT + ' WHERE r.id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Requisition not found.' });

  const myDivisionId = scopeDivisionId(req);
  if (myDivisionId && existing.division_id !== myDivisionId) {
    return res.status(403).json({ error: 'This requisition belongs to another division.' });
  }

  const b = req.body || {};
  const fields = [];
  const params = [];
  const setIf = (col, val) => { if (val !== undefined) { fields.push(`${col} = ?`); params.push(val); } };

  if (b.status !== undefined) {
    if (!REQUISITION_STATUSES.includes(b.status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    fields.push('status = ?', 'reviewed_by = ?', 'reviewed_at = ?');
    params.push(b.status, req.session.username, new Date().toISOString());
  }
  if (b.reviewerNotes !== undefined) {
    fields.push('reviewer_notes = ?');
    params.push(nullableStr(b.reviewerNotes));
  }

  // Correcting a mistake in the original submission — available to admins
  // and, for their own division's requests, department admins too.
  if (b.subcommitteeId !== undefined) {
    const newSubId = Number(b.subcommitteeId);
    const newSub = db.prepare('SELECT id, division_id FROM subcommittees WHERE id = ?').get(newSubId);
    if (!newSub) return res.status(400).json({ error: 'Unknown department.' });
    if (myDivisionId && newSub.division_id !== myDivisionId) {
      return res.status(403).json({ error: "Can't move a requisition outside your division." });
    }
    setIf('subcommittee_id', newSubId);
  }
  if (b.requestorName !== undefined) setIf('requestor_name', str(b.requestorName));
  if (b.requestorContact !== undefined) setIf('requestor_contact', str(b.requestorContact));
  if (b.description !== undefined) setIf('description', str(b.description));
  if (b.recommendedVendor !== undefined) setIf('recommended_vendor', nullableStr(b.recommendedVendor));
  if (b.amountRequested !== undefined) {
    const amount = parseFloat(b.amountRequested);
    if (!(amount > 0)) return res.status(400).json({ error: 'Please enter a valid amount requested.' });
    setIf('amount_requested', amount);
  }
  if (b.dateRequired !== undefined) setIf('date_required', b.dateRequired || null);
  if (b.priority !== undefined) {
    if (!REQUISITION_PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'Invalid priority.' });
    setIf('priority', b.priority);
  }
  if (b.paymentMethod !== undefined) {
    if (!PAYMENT_METHODS.includes(b.paymentMethod)) return res.status(400).json({ error: 'Invalid payment method.' });
    setIf('payment_method', b.paymentMethod);
  }
  if (b.bankingDetails !== undefined) setIf('banking_details', nullableStr(b.bankingDetails));
  if (b.paymentReference !== undefined) setIf('payment_reference', nullableStr(b.paymentReference));
  if (b.proofOfPaymentEmail !== undefined) setIf('proof_of_payment_email', nullableStr(b.proofOfPaymentEmail));
  if (b.actualSpent !== undefined) {
    if (b.actualSpent === null || b.actualSpent === '') {
      setIf('actual_spent', null);
    } else {
      const spent = parseFloat(b.actualSpent);
      if (!(spent >= 0)) return res.status(400).json({ error: 'Please enter a valid amount spent.' });
      setIf('actual_spent', spent);
    }
  }
  if (b.usageNotes !== undefined) setIf('usage_notes', nullableStr(b.usageNotes));

  if (!fields.length) return res.json(attachExtras(existing));
  params.push(id);
  db.prepare(`UPDATE requisitions SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json(attachExtras(db.prepare(REQUISITION_SELECT + ' WHERE r.id = ?').get(id)));
});

router.delete('/requisitions/:id', requireRequisitionAccess, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(REQUISITION_SELECT + ' WHERE r.id = ?').get(id);
  if (!existing) return res.json({ ok: true });

  const myDivisionId = scopeDivisionId(req);
  if (myDivisionId && existing.division_id !== myDivisionId) {
    return res.status(403).json({ error: 'This requisition belongs to another division.' });
  }

  db.prepare('DELETE FROM requisitions WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Shared by the receipt routes below: loads a requisition and 403s if it
// belongs to another division than the requesting department admin's.
function loadScopedRequisition(req, res, id) {
  const row = db.prepare(REQUISITION_SELECT + ' WHERE r.id = ?').get(id);
  if (!row) { res.status(404).json({ error: 'Requisition not found.' }); return null; }
  const myDivisionId = scopeDivisionId(req);
  if (myDivisionId && row.division_id !== myDivisionId) {
    res.status(403).json({ error: 'This requisition belongs to another division.' });
    return null;
  }
  return row;
}

router.post('/requisitions/:id/receipts', requireRequisitionAccess, uploadReceipts, (req, res) => {
  const id = Number(req.params.id);
  const row = loadScopedRequisition(req, res, id);
  if (!row) return;

  const insert = db.prepare('INSERT INTO requisition_receipts (requisition_id, filename, original_name) VALUES (?, ?, ?)');
  for (const file of req.files || []) {
    insert.run(id, file.filename, file.originalname);
  }
  res.status(201).json(attachExtras(row));
});

router.get('/requisitions/:id/receipts/:receiptId/file', requireRequisitionAccess, (req, res) => {
  const id = Number(req.params.id);
  const row = loadScopedRequisition(req, res, id);
  if (!row) return;

  const receipt = db
    .prepare('SELECT * FROM requisition_receipts WHERE id = ? AND requisition_id = ?')
    .get(Number(req.params.receiptId), id);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found.' });
  res.sendFile(path.join(receiptsDir, receipt.filename));
});

router.delete('/requisitions/:id/receipts/:receiptId', requireRequisitionAccess, (req, res) => {
  const id = Number(req.params.id);
  const row = loadScopedRequisition(req, res, id);
  if (!row) return;

  const receipt = db
    .prepare('SELECT * FROM requisition_receipts WHERE id = ? AND requisition_id = ?')
    .get(Number(req.params.receiptId), id);
  if (!receipt) return res.json({ ok: true });

  db.prepare('DELETE FROM requisition_receipts WHERE id = ?').run(receipt.id);
  fs.rm(path.join(receiptsDir, receipt.filename), { force: true }, () => {});
  res.json(attachExtras(row));
});

router.get('/requisitions-export.csv', requireRequisitionAccess, (req, res) => {
  const myDivisionId = scopeDivisionId(req);
  const rows = myDivisionId
    ? db.prepare(REQUISITION_SELECT + ' WHERE d.id = ? ORDER BY r.created_at').all(myDivisionId)
    : db.prepare(REQUISITION_SELECT + ' ORDER BY r.created_at').all();
  const cols = [
    'id', 'requestor_name', 'requestor_contact', 'division_name', 'subcommittee_name',
    'description', 'recommended_vendor', 'amount_requested', 'date_required', 'priority',
    'payment_method', 'banking_details', 'payment_reference', 'proof_of_payment_email',
    'status', 'reviewer_notes', 'reviewed_by', 'reviewed_at', 'created_at',
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="requisitions.csv"');
  res.send(toCsv(rows, cols));
});

router.post('/requisitions-import', requireAdmin, (req, res) => {
  const csvText = (req.body || {}).csv;
  if (!csvText || typeof csvText !== 'string') return res.status(400).json({ error: 'No CSV text provided.' });

  const subs = db.prepare('SELECT id, name FROM subcommittees').all();
  const subByName = new Map(subs.map((s) => [s.name.trim().toLowerCase(), s.id]));

  let records;
  try {
    records = parseCsv(csvText);
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse CSV.' });
  }

  const insert = db.prepare(`
    INSERT INTO requisitions
      (requestor_name, requestor_contact, subcommittee_id, description, recommended_vendor,
       amount_requested, date_required, priority, payment_method, banking_details,
       payment_reference, proof_of_payment_email, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let created = 0;
  const errors = [];
  records.forEach((rec, idx) => {
    const rowNum = idx + 2; // account for header row, 1-indexed
    const get = (...keys) => {
      for (const k of keys) {
        if (rec[k] !== undefined && rec[k] !== '') return rec[k];
      }
      return '';
    };
    const requestorName = get('requestor_name', 'requestorName', 'Name of Requestor');
    const requestorContact = get('requestor_contact', 'requestorContact', 'Contact Number of Requestor');
    const deptName = get('subcommittee_name', 'department', 'Department');
    const description = get('description', 'Description of Request');
    const amount = parseFloat(get('amount_requested', 'amountRequested', 'Amount Requested'));
    const paymentMethodRaw = get('payment_method', 'paymentMethod', 'Cash or Bank?');
    const paymentMethod = PAYMENT_METHODS.find((m) => m.toLowerCase() === String(paymentMethodRaw).toLowerCase());
    const priorityRaw = get('priority', 'Priority') || '3';
    const priority = REQUISITION_PRIORITIES.includes(priorityRaw) ? priorityRaw : '3';
    const subId = subByName.get(String(deptName).trim().toLowerCase());
    const statusRaw = (get('status', 'Status') || 'pending').toLowerCase();
    const status = REQUISITION_STATUSES.includes(statusRaw) ? statusRaw : 'pending';

    if (!requestorName || !requestorContact || !description || !subId || !(amount > 0) || !paymentMethod) {
      errors.push(`Row ${rowNum}: missing or invalid required field(s) (name, contact, department, description, amount, payment method).`);
      return;
    }

    insert.run(
      requestorName,
      requestorContact,
      subId,
      description,
      get('recommended_vendor', 'recommendedVendor', 'Recommended Vendor') || null,
      amount,
      get('date_required', 'dateRequired', 'Date Fund is Required') || null,
      priority,
      paymentMethod,
      get('banking_details', 'bankingDetails', 'Banking Details if Applicable') || null,
      get('payment_reference', 'paymentReference', 'Payment Reference if Applicable') || null,
      get('proof_of_payment_email', 'proofOfPaymentEmail', 'Proof of Payment Email Address if Needed') || null,
      status
    );
    created += 1;
  });

  res.json({ created, failed: errors.length, errors });
});

// ---- Divisions (admin-only — used for the staff-account division picker) ----

router.get('/divisions', requireAdmin, (req, res) => {
  const divisions = db.prepare('SELECT * FROM divisions ORDER BY sort_order').all();
  const subcommittees = db.prepare('SELECT * FROM subcommittees ORDER BY sort_order').all();
  res.json({ divisions, subcommittees });
});

// ---- Budget ----
// Admins see every division. Department admins are scoped to their own.

router.get('/budget', requireRequisitionAccess, (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const myDivisionId = scopeDivisionId(req);
  const rows = db
    .prepare(`
      SELECT s.id AS subcommittee_id, s.name AS subcommittee_name, s.sort_order,
             d.id AS division_id, d.name AS division_name, d.head_name,
             bl.approved_budget, bl.manual_disbursed, bl.manual_refunded,
             COALESCE(req.approved_sum, 0) AS requisition_disbursed
      FROM subcommittees s
      JOIN divisions d ON d.id = s.division_id
      LEFT JOIN budget_lines bl ON bl.subcommittee_id = s.id AND bl.year = ?
      LEFT JOIN (
        SELECT subcommittee_id, SUM(amount_requested) AS approved_sum
        FROM requisitions WHERE status = 'approved' GROUP BY subcommittee_id
      ) req ON req.subcommittee_id = s.id
      WHERE (? IS NULL OR d.id = ?)
      ORDER BY s.sort_order
    `)
    .all(year, myDivisionId, myDivisionId);

  const withTotals = rows.map((r) => {
    const manualDisbursed = r.manual_disbursed || 0;
    const requisitionDisbursed = year === CURRENT_YEAR ? r.requisition_disbursed || 0 : 0;
    const actualDisbursed = manualDisbursed + requisitionDisbursed;
    const refunded = r.manual_refunded || 0;
    const net = actualDisbursed - refunded;
    const approvedBudget = r.approved_budget || 0;
    return {
      ...r,
      approved_budget: approvedBudget,
      actual_disbursed: actualDisbursed,
      requisition_disbursed: requisitionDisbursed,
      refunded,
      net,
      over_under: approvedBudget - net,
    };
  });

  res.json({ year, currentYear: CURRENT_YEAR, lines: withTotals });
});

// Editing budget lines (approved/disbursed/refunded amounts) is super-admin
// only. Department admins can view their division's budget (GET below) and
// approve requisitions, which feeds Actual Disbursed automatically, but
// can't directly change the numbers.
router.post('/budget', requireAdmin, (req, res) => {
  const b = req.body || {};
  const subcommitteeId = Number(b.subcommitteeId);
  const year = Number(b.year);
  if (!subcommitteeId || !year) return res.status(400).json({ error: 'Sub-committee and year are required.' });

  const sub = db.prepare('SELECT id, division_id FROM subcommittees WHERE id = ?').get(subcommitteeId);
  if (!sub) return res.status(400).json({ error: 'Unknown sub-committee.' });

  db.prepare(`
    INSERT INTO budget_lines (subcommittee_id, year, approved_budget, manual_disbursed, manual_refunded)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(subcommittee_id, year) DO UPDATE SET
      approved_budget = excluded.approved_budget,
      manual_disbursed = excluded.manual_disbursed,
      manual_refunded = excluded.manual_refunded
  `).run(
    subcommitteeId,
    year,
    parseFloat(b.approvedBudget) || 0,
    parseFloat(b.manualDisbursed) || 0,
    parseFloat(b.manualRefunded) || 0
  );
  res.json({ ok: true });
});

router.get('/budget-export.csv', requireRequisitionAccess, (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const myDivisionId = scopeDivisionId(req);
  const rows = db
    .prepare(`
      SELECT s.name AS subcommittee_name, d.name AS division_name, d.head_name,
             bl.approved_budget, bl.manual_disbursed, bl.manual_refunded,
             COALESCE(req.approved_sum, 0) AS requisition_disbursed
      FROM subcommittees s
      JOIN divisions d ON d.id = s.division_id
      LEFT JOIN budget_lines bl ON bl.subcommittee_id = s.id AND bl.year = ?
      LEFT JOIN (
        SELECT subcommittee_id, SUM(amount_requested) AS approved_sum
        FROM requisitions WHERE status = 'approved' GROUP BY subcommittee_id
      ) req ON req.subcommittee_id = s.id
      WHERE (? IS NULL OR d.id = ?)
      ORDER BY s.sort_order
    `)
    .all(year, myDivisionId, myDivisionId);

  const csvRows = rows.map((r) => {
    const manualDisbursed = r.manual_disbursed || 0;
    const requisitionDisbursed = year === CURRENT_YEAR ? r.requisition_disbursed || 0 : 0;
    const actualDisbursed = manualDisbursed + requisitionDisbursed;
    const refunded = r.manual_refunded || 0;
    const net = actualDisbursed - refunded;
    const approvedBudget = r.approved_budget || 0;
    return {
      Division: r.division_name,
      Head: r.head_name,
      'Sub-Committee': r.subcommittee_name,
      'Approved Budget': approvedBudget.toFixed(2),
      'Actual Disbursed': actualDisbursed.toFixed(2),
      Refunded: refunded.toFixed(2),
      Net: net.toFixed(2),
      'Over/Under Spending': (approvedBudget - net).toFixed(2),
    };
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="budget-${year}.csv"`);
  res.send(toCsv(csvRows, ['Division', 'Head', 'Sub-Committee', 'Approved Budget', 'Actual Disbursed', 'Refunded', 'Net', 'Over/Under Spending']));
});

router.post('/budget-import', requireAdmin, (req, res) => {
  const { csv: csvText, year } = req.body || {};
  const targetYear = Number(year) || new Date().getFullYear();
  if (!csvText || typeof csvText !== 'string') return res.status(400).json({ error: 'No CSV text provided.' });

  const subs = db.prepare('SELECT id, name FROM subcommittees').all();
  const subByName = new Map(subs.map((s) => [s.name.trim().toLowerCase(), s.id]));

  let records;
  try {
    records = parseCsv(csvText);
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse CSV.' });
  }

  const upsert = db.prepare(`
    INSERT INTO budget_lines (subcommittee_id, year, approved_budget, manual_disbursed, manual_refunded)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(subcommittee_id, year) DO UPDATE SET
      approved_budget = excluded.approved_budget,
      manual_disbursed = excluded.manual_disbursed,
      manual_refunded = excluded.manual_refunded
  `);

  let updated = 0;
  const errors = [];
  const parseMoney = (v) => parseFloat(String(v || '0').replace(/[^0-9.-]/g, '')) || 0;

  records.forEach((rec, idx) => {
    const rowNum = idx + 2;
    const get = (...keys) => {
      for (const k of keys) {
        if (rec[k] !== undefined && rec[k] !== '') return rec[k];
      }
      return '';
    };
    const subName = get('Sub-Committee', 'subcommittee_name', 'subcommittee');
    const subId = subByName.get(String(subName).trim().toLowerCase());
    if (!subId) {
      errors.push(`Row ${rowNum}: unrecognized Sub-Committee "${subName}".`);
      return;
    }
    upsert.run(
      subId,
      targetYear,
      parseMoney(get('Approved Budget', 'approved_budget')),
      parseMoney(get('Actual Disbursed', 'manual_disbursed', 'Disbursed')),
      parseMoney(get('Refunded', 'manual_refunded'))
    );
    updated += 1;
  });

  res.json({ updated, failed: errors.length, errors, year: targetYear });
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
  const { username, pin, role, divisionId } = req.body || {};
  try {
    const user = createUser(username, pin, role, divisionId);
    res.status(201).json(user);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.patch('/users/:id', requireAdmin, (req, res) => {
  const { role, divisionId } = req.body || {};
  try {
    const user = updateUser(Number(req.params.id), { role, divisionId }, req.session.userId);
    res.json(user);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/users/:id/reset-pin', requireAdmin, (req, res) => {
  const { newPin } = req.body || {};
  try {
    resetUserPin(Number(req.params.id), newPin, req.session.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.delete('/users/:id', requireAdmin, (req, res) => {
  try {
    deleteUser(Number(req.params.id), req.session.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
