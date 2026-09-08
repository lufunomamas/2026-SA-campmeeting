const express = require('express');
const { db, getSetting } = require('./db');
const { SA_PROVINCES, EVENT_DEFAULTS } = require('./constants');

const router = express.Router();

router.get('/config', (req, res) => {
  res.json({
    provinces: SA_PROVINCES,
    event: {
      name: getSetting('event_name', EVENT_DEFAULTS.event_name),
      location: getSetting('event_location', EVENT_DEFAULTS.event_location),
      start: getSetting('event_start', EVENT_DEFAULTS.event_start),
      end: getSetting('event_end', EVENT_DEFAULTS.event_end),
    },
  });
});

router.post('/attendees', (req, res) => {
  const b = req.body || {};
  const fullName = (b.fullName || '').trim();
  const originType = b.originType === 'international' ? 'international' : 'province';

  if (!fullName) return res.status(400).json({ error: 'Full name is required.' });
  if (originType === 'province' && !SA_PROVINCES.includes(b.province)) {
    return res.status(400).json({ error: 'Please select a valid province.' });
  }
  if (originType === 'international' && !(b.country || '').trim()) {
    return res.status(400).json({ error: 'Please enter a country.' });
  }

  const numAdults = Math.max(1, parseInt(b.numAdults, 10) || 1);
  const numChildren = Math.max(0, parseInt(b.numChildren, 10) || 0);

  const stmt = db.prepare(`
    INSERT INTO attendees
      (full_name, phone, email, origin_type, province, country, assembly,
       num_adults, num_children, arrival_date, departure_date, accommodation, notes, registered_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'self')
  `);
  const result = stmt.run(
    fullName,
    (b.phone || '').trim() || null,
    (b.email || '').trim() || null,
    originType,
    originType === 'province' ? b.province : null,
    originType === 'international' ? (b.country || '').trim() : null,
    (b.assembly || '').trim() || null,
    numAdults,
    numChildren,
    b.arrivalDate || null,
    b.departureDate || null,
    (b.accommodation || '').trim() || null,
    (b.notes || '').trim() || null
  );

  const row = db.prepare('SELECT * FROM attendees WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.get('/stats', (req, res) => {
  const totals = db
    .prepare('SELECT COUNT(*) AS registrations, COALESCE(SUM(num_adults + num_children),0) AS people, COALESCE(SUM(checked_in),0) AS checked_in FROM attendees')
    .get();
  const byProvince = db
    .prepare(`
      SELECT COALESCE(province, country, 'Unspecified') AS place, origin_type,
             COUNT(*) AS registrations, COALESCE(SUM(num_adults + num_children),0) AS people
      FROM attendees
      GROUP BY place, origin_type
      ORDER BY people DESC
    `)
    .all();
  res.json({ totals, byProvince });
});

router.get('/teams', (req, res) => {
  const teams = db.prepare('SELECT * FROM teams ORDER BY category, name').all();
  res.json(teams);
});

router.get('/roster', (req, res) => {
  const { from, to, team_id } = req.query;
  let sql = `
    SELECT d.*, t.name AS team_name, t.category AS team_category, t.province AS team_province, t.color AS team_color
    FROM duties d JOIN teams t ON t.id = d.team_id
    WHERE 1=1
  `;
  const params = [];
  if (from) { sql += ' AND d.duty_date >= ?'; params.push(from); }
  if (to) { sql += ' AND d.duty_date <= ?'; params.push(to); }
  if (team_id) { sql += ' AND d.team_id = ?'; params.push(team_id); }
  sql += ' ORDER BY d.duty_date, t.category, t.name';
  res.json(db.prepare(sql).all(...params));
});

module.exports = router;
