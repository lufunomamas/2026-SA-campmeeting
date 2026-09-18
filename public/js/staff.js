let teamsCache = [];
let currentRole = null;
let currentUsername = null;

async function checkSession() {
  const { loggedIn, role, username } = await api('/api/staff/session');
  if (loggedIn) showApp(role, username);
}

function showApp(role, username) {
  currentRole = role;
  currentUsername = username;
  document.getElementById('gate').style.display = 'none';
  document.getElementById('app').style.display = '';
  document.getElementById('whoami').textContent = `${username} (${role === 'admin' ? 'admin' : 'check-in'})`;
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.style.display = role === 'admin' ? '' : 'none';
  });
  initApp();
}

document.getElementById('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const pin = document.getElementById('pin').value;
  const alertArea = document.getElementById('gate-alert');
  alertArea.innerHTML = '';
  try {
    const { role } = await api('/api/staff/login', { method: 'POST', body: { username, pin } });
    showApp(role, username.trim().toLowerCase());
  } catch (err) {
    alertArea.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/staff/logout', { method: 'POST' });
  window.location.reload();
});

// ---- Tabs ----
let appInited = false;
const TAB_REFRESH = {
  checkin: () => loadCheckin(),
  registrations: () => loadRegistrations(),
  teams: () => loadTeams(),
  roster: () => loadDuties(),
  requisitions: () => loadRequisitions(),
  budget: () => loadBudget(),
};

function initApp() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      const refresh = TAB_REFRESH[btn.dataset.tab];
      if (refresh && appInited) refresh();
    });
  });

  populateProvinceSelect(document.getElementById('a-province'));

  document.getElementById('checkin-search').addEventListener('input', debounce(loadCheckin, 250));
  document.getElementById('checkin-not-yet').addEventListener('click', (e) => {
    e.target.classList.toggle('active');
    loadCheckin();
  });

  if (appInited) { loadCheckin(); return; }
  appInited = true;

  wireAttendeeDialog();
  loadCheckin();

  if (currentRole !== 'admin') return;

  populateProvinceSelect(document.getElementById('t-province'), '— None —');
  populateProvinceSelect(document.getElementById('reg-province-filter'), 'All provinces');

  wireTeamDialog();
  wireDutyDialog();
  wireSettings();
  wireUserDialogs();
  wireRequisitions();
  wireBudget();

  document.getElementById('reg-search').addEventListener('input', debounce(loadRegistrations, 250));
  document.getElementById('reg-province-filter').addEventListener('change', loadRegistrations);

  loadTeams().then(() => {
    loadRegistrations();
    loadDuties();
  });
  loadUsers();
  loadSubcommitteesCache().then(() => {
    loadRequisitions();
    loadBudget();
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function originLabel(a) {
  return a.origin_type === 'international' ? a.country : a.province;
}

// ---- Check-in ----
async function loadCheckin() {
  const tbody = document.getElementById('checkin-rows');
  const search = document.getElementById('checkin-search').value;
  const notYet = document.getElementById('checkin-not-yet').classList.contains('active');
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (notYet) params.set('checked_in', '0');
  try {
    const rows = await api(`/api/staff/attendees?${params.toString()}`);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No matching attendees.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(
        (a) => `
        <tr>
          <td>${a.full_name}</td>
          <td>${originLabel(a) || '—'}</td>
          <td class="num">${a.num_adults + a.num_children}</td>
          <td>${a.phone || a.email || '—'}</td>
          <td>${a.checked_in ? '<span class="badge badge-green"><span class="badge-dot" style="background:var(--green)"></span>Arrived</span>' : '<span class="badge">Not yet</span>'}</td>
          <td><button class="btn btn-sm ${a.checked_in ? 'btn-quiet' : 'btn-primary'} checkin-btn" data-id="${a.id}" data-state="${a.checked_in}">${a.checked_in ? 'Undo' : 'Check in'}</button></td>
        </tr>`
      )
      .join('');
    tbody.querySelectorAll('.checkin-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const checkedIn = btn.dataset.state !== '1';
        await api(`/api/staff/attendees/${id}/checkin`, { method: 'POST', body: { checkedIn } });
        toast(checkedIn ? 'Checked in' : 'Check-in undone');
        loadCheckin();
        if (currentRole === 'admin') loadRegistrations();
      });
    });
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Could not load attendees.</td></tr>';
  }
}

// ---- Registrations ----
async function loadRegistrations() {
  const tbody = document.getElementById('reg-rows');
  const search = document.getElementById('reg-search').value;
  const province = document.getElementById('reg-province-filter').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (province) params.set('province', province);
  try {
    const rows = await api(`/api/staff/attendees?${params.toString()}`);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No registrations found.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(
        (a) => `
        <tr>
          <td>${a.full_name}</td>
          <td>${originLabel(a) || '—'}</td>
          <td class="num">${a.num_adults}A ${a.num_children}C</td>
          <td>${a.arrival_date ? fmtDate(a.arrival_date) : '—'}${a.departure_date ? ' – ' + fmtDate(a.departure_date) : ''}</td>
          <td><span class="badge">${a.registered_by}</span></td>
          <td>${a.checked_in ? '<span class="badge badge-green">Arrived</span>' : '<span class="badge">Not yet</span>'}</td>
          <td class="row-actions">
            <button class="btn btn-sm btn-quiet edit-att" data-id="${a.id}">Edit</button>
            <button class="btn btn-sm btn-danger del-att" data-id="${a.id}">Delete</button>
          </td>
        </tr>`
      )
      .join('');
    tbody.querySelectorAll('.edit-att').forEach((btn) =>
      btn.addEventListener('click', () => openAttendeeDialog(rows.find((r) => r.id == btn.dataset.id)))
    );
    tbody.querySelectorAll('.del-att').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this registration? This cannot be undone.')) return;
        await api(`/api/staff/attendees/${btn.dataset.id}`, { method: 'DELETE' });
        toast('Registration deleted');
        loadRegistrations();
        loadCheckin();
      })
    );
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Could not load registrations.</td></tr>';
  }
}

// ---- Attendee dialog (add walk-in / edit) ----
let editingAttendeeId = null;
function wireAttendeeDialog() {
  const dialog = document.getElementById('attendee-dialog');
  const form = document.getElementById('attendee-form');

  document.getElementById('add-walkin-btn').addEventListener('click', () => openAttendeeDialog(null));
  document.getElementById('attendee-cancel').addEventListener('click', () => dialog.close());

  document.querySelectorAll('#attendee-form input[name="originType"]').forEach((r) => {
    r.addEventListener('change', () => {
      const isIntl = document.querySelector('#attendee-form input[name="originType"]:checked').value === 'international';
      document.getElementById('a-province-field').style.display = isIntl ? 'none' : '';
      document.getElementById('a-country-field').style.display = isIntl ? '' : 'none';
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.checkedIn = form.checkedIn.checked;
    try {
      if (editingAttendeeId) {
        await api(`/api/staff/attendees/${editingAttendeeId}`, { method: 'PATCH', body: payload });
        toast('Registration updated');
      } else {
        await api('/api/staff/attendees', { method: 'POST', body: payload });
        toast('Walk-in added');
      }
      dialog.close();
      loadRegistrations();
      loadCheckin();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openAttendeeDialog(attendee) {
  editingAttendeeId = attendee ? attendee.id : null;
  const form = document.getElementById('attendee-form');
  form.reset();
  document.getElementById('attendee-dialog-title').textContent = attendee ? 'Edit registration' : 'Add walk-in';
  document.getElementById('a-checkedin-field').style.display = attendee ? 'none' : '';

  if (attendee) {
    form.fullName.value = attendee.full_name || '';
    form.phone.value = attendee.phone || '';
    form.email.value = attendee.email || '';
    form.assembly.value = attendee.assembly || '';
    form.querySelector(`input[name="originType"][value="${attendee.origin_type}"]`).checked = true;
    const isIntl = attendee.origin_type === 'international';
    document.getElementById('a-province-field').style.display = isIntl ? 'none' : '';
    document.getElementById('a-country-field').style.display = isIntl ? '' : 'none';
    if (isIntl) form.country.value = attendee.country || '';
    else form.province.value = attendee.province || '';
    form.numAdults.value = attendee.num_adults;
    form.numChildren.value = attendee.num_children;
    form.arrivalDate.value = attendee.arrival_date || '';
    form.departureDate.value = attendee.departure_date || '';
    form.notes.value = attendee.notes || '';
  }
  document.getElementById('attendee-dialog').showModal();
}

// ---- Teams ----
async function loadTeams() {
  teamsCache = await api('/api/teams');
  renderTeamsList();
  renderTeamSelect();
  renderCategoryOptions();
}

function renderTeamsList() {
  const el = document.getElementById('teams-list');
  if (!teamsCache.length) {
    el.innerHTML = '<p class="empty-state">No teams yet. Add your first cooking or cleaning team above.</p>';
    return;
  }
  const byCategory = {};
  teamsCache.forEach((t) => (byCategory[t.category] = byCategory[t.category] || []).push(t));
  el.innerHTML = Object.entries(byCategory)
    .map(
      ([cat, teams]) => `
      <div class="team-group">
        <h4>${cat}</h4>
        ${teams
          .map(
            (t) => `
          <div class="team-card">
            <span class="team-swatch" style="background:${t.color}"></span>
            <div class="info">
              <div class="name">${t.name}</div>
              <div class="meta">${t.province ? t.province : 'All provinces'}${t.notes ? ' · ' + t.notes : ''}</div>
            </div>
            <div class="row-actions">
              <button class="btn btn-sm btn-quiet edit-team" data-id="${t.id}">Edit</button>
              <button class="btn btn-sm btn-danger del-team" data-id="${t.id}">Delete</button>
            </div>
          </div>`
          )
          .join('')}
      </div>`
    )
    .join('');
  el.querySelectorAll('.edit-team').forEach((btn) =>
    btn.addEventListener('click', () => openTeamDialog(teamsCache.find((t) => t.id == btn.dataset.id)))
  );
  el.querySelectorAll('.del-team').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this team? Its scheduled duties will also be removed.')) return;
      await api(`/api/staff/teams/${btn.dataset.id}`, { method: 'DELETE' });
      toast('Team deleted');
      await loadTeams();
      loadDuties();
    })
  );
}

function renderCategoryOptions() {
  const cats = [...new Set(teamsCache.map((t) => t.category))];
  document.getElementById('category-options').innerHTML = cats.map((c) => `<option value="${c}">`).join('');
}

function renderTeamSelect() {
  const sel = document.getElementById('d-team');
  sel.innerHTML = teamsCache.map((t) => `<option value="${t.id}">${t.name} (${t.category})</option>`).join('');
}

let editingTeamId = null;
function wireTeamDialog() {
  const dialog = document.getElementById('team-dialog');
  const form = document.getElementById('team-form');
  document.getElementById('add-team-btn').addEventListener('click', () => openTeamDialog(null));
  document.getElementById('team-cancel').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    try {
      if (editingTeamId) {
        await api(`/api/staff/teams/${editingTeamId}`, { method: 'PATCH', body: payload });
        toast('Team updated');
      } else {
        await api('/api/staff/teams', { method: 'POST', body: payload });
        toast('Team added');
      }
      dialog.close();
      await loadTeams();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openTeamDialog(team) {
  editingTeamId = team ? team.id : null;
  const form = document.getElementById('team-form');
  form.reset();
  document.getElementById('team-dialog-title').textContent = team ? 'Edit team' : 'Add team';
  if (team) {
    form.name.value = team.name;
    form.category.value = team.category;
    form.province.value = team.province || '';
    form.color.value = team.color || '#B07F26';
    form.notes.value = team.notes || '';
  } else {
    form.color.value = '#B07F26';
  }
  document.getElementById('team-dialog').showModal();
}

// ---- Duties ----
async function loadDuties() {
  const tbody = document.getElementById('duty-rows');
  try {
    const duties = await api('/api/roster');
    if (!duties.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No duties scheduled yet.</td></tr>';
      return;
    }
    tbody.innerHTML = duties
      .map(
        (d) => `
        <tr>
          <td>${fmtDate(d.duty_date)}</td>
          <td><span class="badge" style="border-color:${d.team_color}">${d.team_name}</span></td>
          <td>${d.task}</td>
          <td>${d.notes || '—'}</td>
          <td class="row-actions">
            <button class="btn btn-sm btn-quiet edit-duty" data-id="${d.id}">Edit</button>
            <button class="btn btn-sm btn-danger del-duty" data-id="${d.id}">Delete</button>
          </td>
        </tr>`
      )
      .join('');
    tbody.querySelectorAll('.edit-duty').forEach((btn) =>
      btn.addEventListener('click', () => openDutyDialog(duties.find((d) => d.id == btn.dataset.id)))
    );
    tbody.querySelectorAll('.del-duty').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this duty?')) return;
        await api(`/api/staff/duties/${btn.dataset.id}`, { method: 'DELETE' });
        toast('Duty deleted');
        loadDuties();
      })
    );
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Could not load duty roster.</td></tr>';
  }
}

let editingDutyId = null;
function wireDutyDialog() {
  const dialog = document.getElementById('duty-dialog');
  const form = document.getElementById('duty-form');
  document.getElementById('add-duty-btn').addEventListener('click', () => {
    if (!teamsCache.length) { toast('Add a team first', true); return; }
    openDutyDialog(null);
  });
  document.getElementById('duty-cancel').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    try {
      if (editingDutyId) {
        await api(`/api/staff/duties/${editingDutyId}`, { method: 'PATCH', body: payload });
        toast('Duty updated');
      } else {
        await api('/api/staff/duties', { method: 'POST', body: payload });
        toast('Duty added');
      }
      dialog.close();
      loadDuties();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openDutyDialog(duty) {
  editingDutyId = duty ? duty.id : null;
  renderTeamSelect();
  const form = document.getElementById('duty-form');
  form.reset();
  document.getElementById('duty-dialog-title').textContent = duty ? 'Edit duty' : 'Add duty';
  if (duty) {
    form.teamId.value = duty.team_id;
    form.dutyDate.value = duty.duty_date;
    form.task.value = duty.task;
    form.notes.value = duty.notes || '';
  }
  document.getElementById('duty-dialog').showModal();
}

// ---- Settings ----
function wireSettings() {
  api('/api/staff/settings').then((s) => {
    document.getElementById('s-name').value = s.event_name || '';
    document.getElementById('s-location').value = s.event_location || '';
    document.getElementById('s-start').value = s.event_start || '';
    document.getElementById('s-end').value = s.event_end || '';
  });

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api('/api/staff/settings', { method: 'POST', body: Object.fromEntries(fd.entries()) });
    toast('Event details saved');
  });
}

// ---- Staff accounts ----
async function loadUsers() {
  const el = document.getElementById('users-list');
  try {
    const users = await api('/api/staff/users');
    el.innerHTML = users
      .map(
        (u) => `
      <div class="team-card">
        <div class="info">
          <div class="name">${u.username}${u.username === currentUsername ? ' <span class="badge">You</span>' : ''}</div>
          <div class="meta">${u.role === 'admin' ? 'Admin — full access' : 'Check-in only'}</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-sm btn-quiet reset-pin-btn" data-id="${u.id}" data-username="${u.username}">Reset PIN</button>
          <button class="btn btn-sm btn-danger del-user-btn" data-id="${u.id}">Delete</button>
        </div>
      </div>`
      )
      .join('');
    el.querySelectorAll('.reset-pin-btn').forEach((btn) =>
      btn.addEventListener('click', () => openResetPinDialog(btn.dataset.id, btn.dataset.username))
    );
    el.querySelectorAll('.del-user-btn').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this staff account?')) return;
        try {
          await api(`/api/staff/users/${btn.dataset.id}`, { method: 'DELETE' });
          toast('Account deleted');
          loadUsers();
        } catch (err) {
          toast(err.message, true);
        }
      })
    );
  } catch (e) {
    el.innerHTML = '<p class="empty-state">Could not load staff accounts.</p>';
  }
}

function wireUserDialogs() {
  const userDialog = document.getElementById('user-dialog');
  const userForm = document.getElementById('user-form');
  document.getElementById('add-user-btn').addEventListener('click', () => {
    userForm.reset();
    userDialog.showModal();
  });
  document.getElementById('user-cancel').addEventListener('click', () => userDialog.close());
  userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(userForm);
    try {
      await api('/api/staff/users', { method: 'POST', body: Object.fromEntries(fd.entries()) });
      toast('Staff account added');
      userDialog.close();
      loadUsers();
    } catch (err) {
      toast(err.message, true);
    }
  });

  const resetDialog = document.getElementById('reset-pin-dialog');
  document.getElementById('reset-pin-cancel').addEventListener('click', () => resetDialog.close());
  document.getElementById('reset-pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPin = document.getElementById('rp-pin').value;
    try {
      await api(`/api/staff/users/${resetDialog.dataset.userId}/reset-pin`, { method: 'POST', body: { newPin } });
      toast('PIN reset');
      resetDialog.close();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openResetPinDialog(id, username) {
  const dialog = document.getElementById('reset-pin-dialog');
  dialog.dataset.userId = id;
  document.getElementById('reset-pin-title').textContent = `Reset PIN for ${username}`;
  document.getElementById('reset-pin-form').reset();
  dialog.showModal();
}

// ---- Requisitions & Budget shared ----
let subcommitteesCache = [];

async function loadSubcommitteesCache() {
  const { subcommittees } = await api('/api/subcommittees');
  subcommitteesCache = subcommittees;
}

function fmtMoney(n) {
  return 'R' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function showImportResult(title, result) {
  document.getElementById('import-result-title').textContent = title;
  const created = result.created ?? result.updated ?? 0;
  const label = result.created !== undefined ? 'created' : 'updated';
  document.getElementById('import-result-body').innerHTML = `
    <p><strong>${created}</strong> row(s) ${label}. <strong>${result.failed || 0}</strong> failed.</p>
    ${result.errors && result.errors.length ? `<div class="alert alert-error" style="max-height:200px; overflow-y:auto;">${result.errors.map((e) => `<div>${e}</div>`).join('')}</div>` : ''}
  `;
  document.getElementById('import-result-dialog').showModal();
}

document.getElementById('import-result-close').addEventListener('click', () => {
  document.getElementById('import-result-dialog').close();
});

// ---- Requisitions ----
let reqStatusFilter = '';

async function loadRequisitions() {
  const tbody = document.getElementById('req-rows');
  const params = new URLSearchParams();
  const search = document.getElementById('req-search').value;
  if (reqStatusFilter) params.set('status', reqStatusFilter);
  if (search) params.set('search', search);
  try {
    const rows = await api(`/api/staff/requisitions?${params.toString()}`);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No requisitions found.</td></tr>';
      return;
    }
    const statusBadge = { pending: 'badge', review: 'badge badge-gold', approved: 'badge badge-green', declined: 'badge badge-brick' };
    const statusLabel = { pending: 'Pending', review: 'Review', approved: 'Approved', declined: 'Declined' };
    tbody.innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td>${fmtDate(r.date_required) || fmtDate(r.created_at.slice(0, 10))}</td>
          <td>${r.requestor_name}</td>
          <td>${r.subcommittee_name}</td>
          <td>${r.description.length > 50 ? r.description.slice(0, 50) + '…' : r.description}</td>
          <td class="num">${fmtMoney(r.amount_requested)}</td>
          <td>${r.priority}</td>
          <td><span class="${statusBadge[r.status]}">${statusLabel[r.status]}</span></td>
          <td><button class="btn btn-sm btn-quiet review-req-btn" data-id="${r.id}">Review</button></td>
        </tr>`
      )
      .join('');
    tbody.querySelectorAll('.review-req-btn').forEach((btn) =>
      btn.addEventListener('click', () => openRequisitionDialog(rows.find((r) => r.id == btn.dataset.id)))
    );
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Could not load requisitions.</td></tr>';
  }
}

function openRequisitionDialog(r) {
  const dialog = document.getElementById('req-dialog');
  dialog.dataset.id = r.id;
  dialog.dataset.contact = r.requestor_contact;
  document.getElementById('rq-id').textContent = `#${r.id} — ${r.division_name} / ${r.subcommittee_name}`;
  document.getElementById('rq-submitted').textContent = `Submitted ${fmtDate(r.created_at.slice(0, 10))} by ${r.requestor_name} (${r.requestor_contact})`;

  const rows = [
    ['Description', r.description],
    ['Recommended vendor', r.recommended_vendor || '—'],
    ['Amount requested', fmtMoney(r.amount_requested)],
    ['Date fund required', fmtDate(r.date_required) || '—'],
    ['Priority', r.priority],
    ['Cash or bank', r.payment_method],
    ['Banking details', r.banking_details || '—'],
    ['Payment reference', r.payment_reference || '—'],
    ['Proof of payment email', r.proof_of_payment_email || '—'],
  ];
  document.getElementById('rq-details').innerHTML = rows
    .map(([label, value]) => `<div><div class="field-label-inline">${label}</div><div>${value}</div></div>`)
    .join('');

  document.getElementById('rq-status').value = r.status;
  document.getElementById('rq-notes').value = r.reviewer_notes || '';

  const statusMessage = {
    pending: 'is still pending review',
    review: 'is under review — we may follow up with questions',
    approved: 'has been APPROVED',
    declined: 'has been DECLINED',
  };
  const message =
    `Hi ${r.requestor_name}, your requisition for ${r.subcommittee_name} (${fmtMoney(r.amount_requested)}) ${statusMessage[r.status]}.` +
    (r.reviewer_notes ? `\n\nNote: ${r.reviewer_notes}` : '');
  document.getElementById('rq-whatsapp-link').href = waLink(r.requestor_contact, message);

  dialog.showModal();
}

function wireRequisitions() {
  const dialog = document.getElementById('req-dialog');
  document.getElementById('rq-cancel').addEventListener('click', () => dialog.close());
  document.getElementById('rq-save').addEventListener('click', async () => {
    const id = dialog.dataset.id;
    const status = document.getElementById('rq-status').value;
    const reviewerNotes = document.getElementById('rq-notes').value;
    try {
      await api(`/api/staff/requisitions/${id}`, { method: 'PATCH', body: { status, reviewerNotes } });
      toast('Requisition updated');
      dialog.close();
      loadRequisitions();
      loadBudget();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('req-search').addEventListener('input', debounce(loadRequisitions, 250));
  document.querySelectorAll('#req-status-filter button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#req-status-filter button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      reqStatusFilter = btn.dataset.status;
      loadRequisitions();
    });
  });

  const fileInput = document.getElementById('req-import-file');
  document.getElementById('req-import-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const csv = await readFileAsText(file);
      const result = await api('/api/staff/requisitions-import', { method: 'POST', body: { csv } });
      showImportResult('Requisitions import', result);
      loadRequisitions();
    } catch (err) {
      toast(err.message, true);
    } finally {
      fileInput.value = '';
    }
  });
}

// ---- Budget ----
let budgetYear = 2026;

async function loadBudget() {
  const el = document.getElementById('budget-content');
  try {
    const { lines } = await api(`/api/staff/budget?year=${budgetYear}`);
    const byDivision = {};
    lines.forEach((l) => (byDivision[l.division_name] = byDivision[l.division_name] || []).push(l));

    const grand = { approved: 0, disbursed: 0, refunded: 0, net: 0, overUnder: 0 };

    el.innerHTML = Object.entries(byDivision)
      .map(([division, rows]) => {
        const headName = rows[0].head_name || '';
        const sub = { approved: 0, disbursed: 0, refunded: 0, net: 0, overUnder: 0 };
        const rowsHtml = rows
          .map((r) => {
            sub.approved += r.approved_budget;
            sub.disbursed += r.actual_disbursed;
            sub.refunded += r.refunded;
            sub.net += r.net;
            sub.overUnder += r.over_under;
            const overUnderClass = r.over_under < 0 ? 'amount-negative' : 'amount-positive';
            return `
            <div class="budget-row">
              <div>${r.subcommittee_name}</div>
              <div class="num"><span class="budget-col-label">Approved</span>${fmtMoney(r.approved_budget)}</div>
              <div class="num"><span class="budget-col-label">Disbursed</span>${fmtMoney(r.actual_disbursed)}</div>
              <div class="num"><span class="budget-col-label">Refunded</span>${fmtMoney(r.refunded)}</div>
              <div class="num ${overUnderClass}"><span class="budget-col-label">Over/Under</span>${fmtMoney(r.over_under)}</div>
              <div><button class="btn btn-sm btn-quiet edit-budget-btn" data-id="${r.subcommittee_id}">Edit</button></div>
            </div>`;
          })
          .join('');
        grand.approved += sub.approved;
        grand.disbursed += sub.disbursed;
        grand.refunded += sub.refunded;
        grand.net += sub.net;
        grand.overUnder += sub.overUnder;
        return `
        <div class="budget-division">
          <div class="budget-division-head">
            <h4>${division}</h4>
            <span class="head-name">${headName}</span>
          </div>
          ${rowsHtml}
          <div class="budget-row totals">
            <div>Subtotal</div>
            <div class="num">${fmtMoney(sub.approved)}</div>
            <div class="num">${fmtMoney(sub.disbursed)}</div>
            <div class="num">${fmtMoney(sub.refunded)}</div>
            <div class="num ${sub.overUnder < 0 ? 'amount-negative' : 'amount-positive'}">${fmtMoney(sub.overUnder)}</div>
            <div></div>
          </div>
        </div>`;
      })
      .join('') +
      `<div class="budget-grand-total">
        <div>Grand total</div>
        <div class="num">${fmtMoney(grand.approved)}</div>
        <div class="num">${fmtMoney(grand.disbursed)}</div>
        <div class="num">${fmtMoney(grand.refunded)}</div>
        <div class="num">${fmtMoney(grand.overUnder)}</div>
        <div></div>
      </div>`;

    el.querySelectorAll('.edit-budget-btn').forEach((btn) =>
      btn.addEventListener('click', () => {
        const line = lines.find((l) => l.subcommittee_id == btn.dataset.id);
        openBudgetDialog(line);
      })
    );
  } catch (e) {
    el.innerHTML = '<p class="empty-state">Could not load the budget.</p>';
  }
}

function openBudgetDialog(line) {
  const dialog = document.getElementById('budget-dialog');
  dialog.dataset.subcommitteeId = line.subcommittee_id;
  document.getElementById('budget-dialog-title').textContent = `Edit ${line.subcommittee_name} — ${budgetYear}`;
  document.getElementById('bg-approved').value = line.approved_budget;
  document.getElementById('bg-disbursed').value = line.manual_disbursed;
  document.getElementById('bg-refunded').value = line.manual_refunded;
  dialog.showModal();
}

function wireBudget() {
  const dialog = document.getElementById('budget-dialog');
  document.getElementById('budget-cancel').addEventListener('click', () => dialog.close());
  document.getElementById('budget-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/staff/budget', {
        method: 'POST',
        body: {
          subcommitteeId: dialog.dataset.subcommitteeId,
          year: budgetYear,
          approvedBudget: document.getElementById('bg-approved').value,
          manualDisbursed: document.getElementById('bg-disbursed').value,
          manualRefunded: document.getElementById('bg-refunded').value,
        },
      });
      toast('Budget line updated');
      dialog.close();
      loadBudget();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.querySelectorAll('#budget-year-filter button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#budget-year-filter button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      budgetYear = Number(btn.dataset.year);
      document.getElementById('budget-export-link').href = `/api/staff/budget-export.csv?year=${budgetYear}`;
      loadBudget();
    });
  });

  const fileInput = document.getElementById('budget-import-file');
  document.getElementById('budget-import-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const csv = await readFileAsText(file);
      const result = await api('/api/staff/budget-import', { method: 'POST', body: { csv, year: budgetYear } });
      showImportResult(`Budget import — ${budgetYear}`, result);
      loadBudget();
    } catch (err) {
      toast(err.message, true);
    } finally {
      fileInput.value = '';
    }
  });
}

checkSession();
