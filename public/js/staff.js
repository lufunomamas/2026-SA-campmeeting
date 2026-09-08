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
function initApp() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
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

  document.getElementById('reg-search').addEventListener('input', debounce(loadRegistrations, 250));
  document.getElementById('reg-province-filter').addEventListener('change', loadRegistrations);

  loadTeams().then(() => {
    loadRegistrations();
    loadDuties();
  });
  loadUsers();
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

checkSession();
