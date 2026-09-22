function renderNav(active) {
  const links = [
    ['/', 'Home'],
    ['/roster.html', 'Duty Roster'],
    ['/requisition.html', 'Requisition'],
    ['/staff.html', 'Staff'],
  ];
  const el = document.getElementById('site-nav');
  if (!el) return;
  el.innerHTML = `
    <nav class="nav">
      <a class="brand" href="/">
        <span class="brand-mark" id="brand-mark">Campmeeting</span>
        <span class="brand-sub" id="brand-sub">South Africa</span>
      </a>
      <button class="nav-toggle" id="nav-toggle" aria-label="Toggle menu">&#9776;</button>
      <ul class="nav-links" id="nav-links">
        ${links
          .map(
            ([href, label]) =>
              `<li><a href="${href}" class="${active === href ? 'active' : ''}">${label}</a></li>`
          )
          .join('')}
      </ul>
    </nav>
  `;
  document.getElementById('nav-toggle').addEventListener('click', () => {
    document.getElementById('nav-links').classList.toggle('open');
  });
  loadEventConfig();
}

let _configCache = null;
async function loadEventConfig() {
  if (_configCache) return _configCache;
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    _configCache = data;
    const mark = document.getElementById('brand-mark');
    const sub = document.getElementById('brand-sub');
    if (mark && data.event) mark.textContent = data.event.name;
    if (sub && data.event) sub.textContent = data.event.location;
    document.querySelectorAll('[data-event-name]').forEach((n) => (n.textContent = data.event.name));
    document.querySelectorAll('[data-event-location]').forEach((n) => (n.textContent = data.event.location));
    document.querySelectorAll('[data-event-dates]').forEach(
      (n) => (n.textContent = `${fmtDate(data.event.start)} – ${fmtDate(data.event.end)}`)
    );
    return data;
  } catch (e) {
    return null;
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toast(msg, isError) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = isError ? 'var(--brick)' : 'var(--ink)';
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

/** Normalizes a South African-style number to international digits-only
 * form for a wa.me link (leading 0 -> 27, strips spaces/dashes/+). */
function waDigits(phone) {
  let d = String(phone || '').replace(/[^\d]/g, '');
  if (d.startsWith('0')) d = '27' + d.slice(1);
  return d;
}

function waLink(phone, message) {
  return `https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(message)}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname === '/index.html' ? '/' : window.location.pathname;
  renderNav(path);
});
