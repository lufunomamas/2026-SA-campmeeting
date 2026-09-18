const { db } = require('./db');

// Division -> head(s) -> sub-committees, in the order they appear in the
// 2025 budget sheet. Sub-committee names match the Requisition Form's
// Department dropdown exactly.
const DIVISIONS = [
  {
    name: 'Worship',
    head: 'Bro Frans Kekana',
    subcommittees: [
      ['Choir and Orchestra', 3000, 840, 0],
      ['Sunday School & Elementary', 5000, 4500, 0],
      ['Audio visual', 15000, 12350, 0],
      ['Stage Management', 0, 9000, 122.65],
      ['Usherers/Deacons/Greeters', 2000, 2000, 450],
      ['Interpretation', 0, 0, 0],
      ['Ordinance Preparation', 8000, 6000, 0],
    ],
  },
  {
    name: 'Catering & Décor',
    head: 'Sis Bonisile Mashau',
    subcommittees: [
      ['Kitchen', 50000, 99337, 0],
      ['Tuckshop', 10000, 9000, 16322.3],
      ['Stumping Ground', 15000, 10000, 12765],
      ['Workers Meeting', 10000, 9000, 0],
      ['Dinning Management & Décor', 8000, 19200, 0],
      ['DS House Supplies', 2000, 1235, 0],
    ],
  },
  {
    name: 'Administration',
    head: 'Bro David Oyedokun',
    subcommittees: [
      ['Camp Office & Communication', 1610, 1610, 0],
      ['Transportation', 23125.5, 25276.39, 0],
      ['Security', 390, 390, 0],
      ['Health, Safety & Wellness', 3310, 3310, 0],
      ['Souvenir', 10000, 10000, 11032],
    ],
  },
  {
    name: 'Accommodation',
    head: 'Bro Mudzi Mate',
    subcommittees: [
      ['Accommodation: Campsite', 23470, 15767.15, 0],
      ['Accommodation: Offsite', 48000, 12000, 0],
    ],
  },
  {
    name: 'Development',
    head: 'Bro Mahlatsi Thibela',
    subcommittees: [
      ['Maintenance & Landscaping', 5000, 5000, 0],
      ['Waste Management', 6040, 6040, 881.65],
      ['Cleaning & Hygiene', 9793, 9793, 1056.6],
    ],
  },
  {
    name: 'Coordination',
    head: 'Sis Angel Chiloane, Bro Mulalo Mapfumo, Bro Kaisi Lebeta',
    subcommittees: [
      ['Camp Planning & Reporting', 10000, 10209.4, 0],
      ['Procurement & Asset Management', 0, 0, 0],
    ],
  },
];

const HISTORICAL_YEAR = 2025;
const CURRENT_YEAR = 2026;

function ensureBudgetSeeded() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM divisions').get().n;
  if (count > 0) return;

  const insertDivision = db.prepare('INSERT INTO divisions (name, head_name, sort_order) VALUES (?, ?, ?)');
  const insertSub = db.prepare('INSERT INTO subcommittees (division_id, name, sort_order) VALUES (?, ?, ?)');
  const insertBudgetLine = db.prepare(`
    INSERT INTO budget_lines (subcommittee_id, year, approved_budget, manual_disbursed, manual_refunded)
    VALUES (?, ?, ?, ?, ?)
  `);

  let subSort = 0;
  DIVISIONS.forEach((division, divIndex) => {
    const divResult = insertDivision.run(division.name, division.head, divIndex);
    division.subcommittees.forEach(([name, approved, disbursed, refunded]) => {
      subSort += 1;
      const subResult = insertSub.run(divResult.lastInsertRowid, name, subSort);
      insertBudgetLine.run(subResult.lastInsertRowid, HISTORICAL_YEAR, approved, disbursed, refunded);
      insertBudgetLine.run(subResult.lastInsertRowid, CURRENT_YEAR, 0, 0, 0);
    });
  });
}

module.exports = { ensureBudgetSeeded, HISTORICAL_YEAR, CURRENT_YEAR };
