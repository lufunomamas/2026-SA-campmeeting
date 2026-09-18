const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');

const { ensureDefaultAdminSeeded, DEFAULT_USERNAME, DEFAULT_PIN } = require('./auth');
const { setSetting, getSetting } = require('./db');
const { EVENT_DEFAULTS } = require('./constants');
const { ensureBudgetSeeded } = require('./budget_seed');

ensureDefaultAdminSeeded();
ensureBudgetSeeded();
Object.entries(EVENT_DEFAULTS).forEach(([key, val]) => {
  if (getSetting(key) === undefined) setSetting(key, val);
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '5mb' }));
app.use(
  session({
    name: 'camp.sid',
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

app.use('/api', require('./routes-public'));
app.use('/api/staff', require('./routes-staff'));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Campmeeting app listening on port ${PORT}`);
  console.log(`Default admin login is "${DEFAULT_USERNAME}" / PIN "${DEFAULT_PIN}" (only created if no accounts exist yet).`);
});
