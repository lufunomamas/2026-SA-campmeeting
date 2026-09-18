function escapeCsvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, cols) {
  const lines = [cols.join(',')];
  rows.forEach((row) => {
    lines.push(cols.map((c) => escapeCsvField(row[c])).join(','));
  });
  return lines.join('\n');
}

/** Minimal RFC4180 parser: handles quoted fields, escaped quotes, commas
 * and newlines inside quotes. Returns an array of objects keyed by the
 * header row. Blank lines are skipped. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };

  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushField();
      pushRow();
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { pushField(); pushRow(); }

  const nonEmptyRows = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (!nonEmptyRows.length) return [];
  const headers = nonEmptyRows[0].map((h) => h.trim());
  return nonEmptyRows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx].trim() : ''; });
    return obj;
  });
}

module.exports = { toCsv, parseCsv };
