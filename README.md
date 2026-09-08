# Campmeeting Registration & Duty Roster

A self-contained web app for the South Africa campmeeting: attendees register themselves
(or get checked in by staff at the gate), and organizers manage a cooking/cleaning/any-other
duty roster by date and team.

## What it does

- **Public registration** (`/register.html`) — anyone with the link registers their household:
  name, contact details, home province or country, group size, stay dates, accommodation.
- **Public duty roster** (`/roster.html`) — anyone can see which team is on duty on which date,
  filterable by team.
- **Home page** (`/`) — live count of who's registered, broken down by province/country.
- **Staff area** (`/staff.html`, username + PIN login, two access tiers) —
  - **Check-in accounts** only see the **Check-In** tab: search attendees, mark arrivals,
    add walk-ins. Good for gate volunteers.
  - **Admin accounts** see everything: Check-In, plus —
    - **Registrations**: full list, edit/delete, export to CSV.
    - **Teams**: add any number of duty teams (Cooking, Cleaning, Ushering, Security, ... —
      type any category you like, per-province if relevant).
    - **Duty roster**: assign a team to a date + task.
    - **Settings**: event name/location/dates, and manage staff accounts (add, delete,
      reset PINs, set who's admin vs. check-in only).

## Tech

Plain Node.js + Express, with the built-in `node:sqlite` module (no native build tools
needed) storing data in `server/data/church.db`. The frontend is plain HTML/CSS/JS — no
build step.

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000. The first time the app runs with an empty database, it
creates one admin account — username **lufunom**, PIN **3698** (or whatever you set via the
`ADMIN_USERNAME` / `ADMIN_PIN` environment variables before that first run). Sign in at
Staff, then add real accounts for everyone else under Settings → Staff accounts (each one
is either "admin" or "check-in only") — and consider deleting or repurposing the default
account once you have your own.

## Deploying so it's reachable from anywhere

This needs a host that (a) runs Node.js and (b) keeps `server/data/church.db` on a
**persistent disk** — a normal "ephemeral" free web host wipes the file on every restart
and you'd lose all registrations.

### Option A — Render (recommended)

**Important:** Render's *free* web services cannot attach a persistent disk — any
registrations saved to `church.db` would be wiped the next time the service restarts,
redeploys, or spins down from inactivity. Reliable storage needs the **Starter** plan
(~$7/month), which supports both an always-on service and a persistent disk. There is no
way around this on Render specifically; see Option D below if you'd rather not pay.

1. Push this folder to a GitHub repo (see "Getting this into GitHub" below).
2. On [render.com](https://render.com), **New → Blueprint**, and point it at the repo —
   it will read the included `render.yaml` and pre-fill the service, disk, and environment
   variables for you (still on the Starter plan, for the disk).
   Alternatively, **New → Web Service** manually:
   - Build command: `npm install`. Start command: `npm start`.
   - Instance type: **Starter** (needed for the disk).
   - Add a **Disk**: mount path `/var/data`, 1 GB is plenty.
   - Add an environment variable `DATA_DIR` = `/var/data`.
   - Add an environment variable `SESSION_SECRET` = (any long random string).
3. Optionally set `ADMIN_USERNAME` / `ADMIN_PIN` for the first account (otherwise it
   defaults to `lufunom` / `3698` on first boot — add your real accounts in Settings
   afterwards either way, admin or check-in only).
4. Deploy. Render gives you a `https://your-app.onrender.com` link — that's what you share.

### Option B — Railway

Same idea: connect the repo, add a persistent **volume** mounted at e.g. `/data`, set
`DATA_DIR=/data`, set `SESSION_SECRET`, deploy. Railway auto-detects the Node app and runs
`npm start`.

### Option C — Your own VPS

```bash
git clone <your-repo>
cd campmeeting
npm install
DATA_DIR=/srv/campmeeting-data SESSION_SECRET=<random> PORT=3000 npm start
```
Put it behind a reverse proxy (nginx/Caddy) for HTTPS, and run it under a process
manager (pm2 / systemd) so it restarts on crash or reboot.

### Option D — genuinely free, more setup

Render/Railway free tiers don't persist local files, but a free *hosted database* (e.g.
[Neon](https://neon.tech) or [Supabase](https://supabase.com), both have a free Postgres
tier) does. That needs swapping the `node:sqlite` layer in `server/db.js` for a Postgres
client — a real code change, not just a config change, so it's not done here. Ask if you'd
like this built.

## Getting this into GitHub

This folder is already a git repo with one commit. To push it:

1. Create an empty repository on [github.com/new](https://github.com/new) — don't
   initialize it with a README (this folder already has one).
2. Copy the repo URL it gives you, then run:
   ```bash
   git remote add origin <the-url-github-gave-you>
   git push -u origin main
   ```
   Git/Windows will pop up a browser window for you to sign in — nothing to paste here.
3. That repo is what you connect to Render (or Railway) in the steps above.

## Environment variables

| Variable         | Purpose                                                        | Default             |
|-------------------|-----------------------------------------------------------------|----------------------|
| `PORT`            | Port to listen on                                               | `3000`               |
| `DATA_DIR`        | Where `church.db` is stored — point this at your persistent disk | `server/data`         |
| `SESSION_SECRET`  | Signs staff login cookies — set a real random value in production | random each boot     |
| `ADMIN_USERNAME`  | Username for the one account auto-created when the database is empty | `lufunom`      |
| `ADMIN_PIN`       | PIN for that same first-boot account | `3698`     |

## Backing up your data

The whole database is one file: `server/data/church.db` (or wherever `DATA_DIR` points).
Copy it somewhere safe periodically — e.g. `cp server/data/church.db backup-$(date +%F).db`.
CSV export of registrations is also available from Staff → Registrations → Export CSV.
