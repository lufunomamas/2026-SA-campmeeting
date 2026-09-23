let teamsCache = [];
let currentRole = null;
let currentUsername = null;
let currentDivisionId = null;
let currentDivisionName = null;

const ROLE_LABEL = { admin: 'super admin', department_admin: 'department admin', checkin: 'check-in' };

async function checkSession() {
  const { loggedIn, role, username, divisionId, divisionName } = await api('/api/staff/session');
  if (loggedIn) showApp(role, username, divisionId, divisionName);
}

function showApp(role, username, divisionId, divisionName) {
  currentRole = role;
  currentUsername = username;
  currentDivisionId = divisionId || null;
  currentDivisionName = divisionName || null;

  document.getElementById('gate').style.display = 'none';
  document.getElementById('app').style.display = '';

  const tabs = [...document.querySelectorAll('.tab-btn')];
  let firstVisible = null;
  tabs.forEach((btn) => {
    const allowed = (btn.dataset.roles || '').split(',');
    const visible = allowed.includes(role);
    btn.style.display = visible ? '' : 'none';
    if (visible && !firstVisible) firstVisible = btn;
  });
  if (firstVisible && !tabs.some((b) => b.classList.contains('active') && b.style.display !== 'none')) {
    tabs.forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    firstVisible.classList.add('active');
    document.getElementById(`tab-${firstVisible.dataset.tab}`).classList.add('active');
  }

  document.querySelectorAll('.super-admin-only').forEach((el) => {
    el.style.display = role === 'admin' ? '' : 'none';
  });

  initApp();

  const roleLabel = ROLE_LABEL[role] || role;
  document.getElementById('whoami').textContent = divisionName
    ? `${username} (${roleLabel} — ${divisionName})`
    : `${username} (${roleLabel})`;
}

document.getElementById('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const pin = document.getElementById('pin').value;
  const alertArea = document.getElementById('gate-alert');
  alertArea.innerHTML = '';
  try {
    await api('/api/staff/login', { method: 'POST', body: { username, pin } });
    const session = await api('/api/staff/session');
    showApp(session.role, session.username, session.divisionId, session.divisionName);
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
  const canCheckin = currentRole === 'admin' || currentRole === 'checkin';
  const canRequisitions = currentRole === 'admin' || currentRole === 'department_admin';
  const isSuperAdmin = currentRole === 'admin';

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

  if (canCheckin) {
    document.getElementById('checkin-search').addEventListener('input', debounce(loadCheckin, 250));
    document.getElementById('checkin-not-yet').addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      loadCheckin();
    });
  }

  if (appInited) {
    if (canCheckin) loadCheckin();
    return;
  }
  appInited = true;

  if (canCheckin) {
    wireAttendeeDialog();
    loadCheckin();
  }

  if (canRequisitions) {
    wireRequisitions();
    wireBudget();
    loadSubcommitteesCache().then(() => {
      loadRequisitions();
      loadBudget();
    });
  }

  if (!isSuperAdmin) return;

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
const ROLE_ROW_LABEL = { admin: 'Super admin — full access', department_admin: 'Department admin', checkin: 'Check-in only' };
let divisionsCache = [];
let usersCache = [];

async function loadDivisionsCache() {
  if (divisionsCache.length) return divisionsCache;
  const { divisions } = await api('/api/staff/divisions');
  divisionsCache = divisions;
  return divisions;
}

function populateDivisionSelect(select) {
  select.innerHTML = divisionsCache.map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
}

async function loadUsers() {
  const el = document.getElementById('users-list');
  try {
    await loadDivisionsCache();
    populateDivisionSelect(document.getElementById('u-division'));
    populateDivisionSelect(document.getElementById('eu-division'));
    usersCache = await api('/api/staff/users');
    el.innerHTML = usersCache
      .map((u) => {
        const roleLabel = ROLE_ROW_LABEL[u.role] || u.role;
        const meta = u.role === 'department_admin' && u.division_name ? `${roleLabel} — ${u.division_name}` : roleLabel;
        const isSelf = u.username === currentUsername;
        const lockedForMe = u.protected && !isSelf;
        const actions = lockedForMe
          ? `<span class="badge" title="Only ${u.username} can change this account">Protected</span>`
          : `
          <button class="btn btn-sm btn-quiet edit-user-btn" data-id="${u.id}">Edit</button>
          <button class="btn btn-sm btn-quiet reset-pin-btn" data-id="${u.id}" data-username="${u.username}">Reset PIN</button>
          <button class="btn btn-sm btn-danger del-user-btn" data-id="${u.id}">Delete</button>`;
        return `
      <div class="team-card">
        <div class="info">
          <div class="name">${u.username}${isSelf ? ' <span class="badge">You</span>' : ''}${u.protected ? ' <span class="badge badge-gold">Owner</span>' : ''}</div>
          <div class="meta">${meta}</div>
        </div>
        <div class="row-actions">${actions}</div>
      </div>`;
      })
      .join('');
    el.querySelectorAll('.edit-user-btn').forEach((btn) =>
      btn.addEventListener('click', () => openEditUserDialog(usersCache.find((u) => u.id == btn.dataset.id)))
    );
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

function toggleDivisionField(roleRadios, divisionField, divisionSelect) {
  const role = [...roleRadios].find((r) => r.checked)?.value;
  const show = role === 'department_admin';
  divisionField.style.display = show ? '' : 'none';
  divisionSelect.required = show;
}

function wireUserDialogs() {
  const userDialog = document.getElementById('user-dialog');
  const userForm = document.getElementById('user-form');
  const userDivisionField = document.getElementById('u-division-field');
  const userDivisionSelect = document.getElementById('u-division');
  const userRoleRadios = userForm.querySelectorAll('input[name="role"]');

  userRoleRadios.forEach((r) => r.addEventListener('change', () => toggleDivisionField(userRoleRadios, userDivisionField, userDivisionSelect)));

  document.getElementById('add-user-btn').addEventListener('click', () => {
    userForm.reset();
    toggleDivisionField(userRoleRadios, userDivisionField, userDivisionSelect);
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

  // Edit permissions dialog
  const editDialog = document.getElementById('edit-user-dialog');
  const editForm = document.getElementById('edit-user-form');
  const editDivisionField = document.getElementById('eu-division-field');
  const editDivisionSelect = document.getElementById('eu-division');
  const editRoleRadios = editForm.querySelectorAll('input[name="role"]');
  editRoleRadios.forEach((r) => r.addEventListener('change', () => toggleDivisionField(editRoleRadios, editDivisionField, editDivisionSelect)));

  document.getElementById('edit-user-cancel').addEventListener('click', () => editDialog.close());
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(editForm);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api(`/api/staff/users/${editDialog.dataset.userId}`, { method: 'PATCH', body: payload });
      toast('Permissions updated');
      editDialog.close();
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

function openEditUserDialog(user) {
  const dialog = document.getElementById('edit-user-dialog');
  const form = document.getElementById('edit-user-form');
  dialog.dataset.userId = user.id;
  document.getElementById('edit-user-title').textContent = `Edit ${user.username}`;
  form.querySelector(`input[name="role"][value="${user.role}"]`).checked = true;
  if (user.division_id) document.getElementById('eu-division').value = user.division_id;
  toggleDivisionField(form.querySelectorAll('input[name="role"]'), document.getElementById('eu-division-field'), document.getElementById('eu-division'));
  dialog.showModal();
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
let priorityOptionsCache = [];
let paymentMethodOptionsCache = [];

async function loadSubcommitteesCache() {
  const { subcommittees, priorities, paymentMethods } = await api('/api/subcommittees');
  subcommitteesCache = subcommittees;
  priorityOptionsCache = priorities;
  paymentMethodOptionsCache = paymentMethods;
}

function populateSubcommitteeSelect(select) {
  const byDivision = {};
  subcommitteesCache.forEach((s) => (byDivision[s.division_name] = byDivision[s.division_name] || []).push(s));
  select.innerHTML = Object.entries(byDivision)
    .map(
      ([division, items]) =>
        `<optgroup label="${division}">${items.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</optgroup>`
    )
    .join('');
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
let requisitionDialogRow = null;

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
  requisitionDialogRow = r;
  document.getElementById('rq-id').textContent = `#${r.id} — ${r.division_name} / ${r.subcommittee_name}`;
  document.getElementById('rq-submitted').textContent = `Submitted ${fmtDate(r.created_at.slice(0, 10))} by ${r.requestor_name} (${r.requestor_contact})`;

  populateSubcommitteeSelect(document.getElementById('rq-subcommittee'));
  document.getElementById('rq-priority').innerHTML = priorityOptionsCache.map((p) => `<option value="${p}">${p}</option>`).join('');
  document.getElementById('rq-paymentMethod').innerHTML = paymentMethodOptionsCache.map((m) => `<option value="${m}">${m}</option>`).join('');

  const form = document.getElementById('req-review-form');
  form.requestorName.value = r.requestor_name;
  form.requestorContact.value = r.requestor_contact;
  form.subcommitteeId.value = r.subcommittee_id;
  form.description.value = r.description;
  form.recommendedVendor.value = r.recommended_vendor || '';
  form.amountRequested.value = r.amount_requested;
  form.dateRequired.value = r.date_required || '';
  form.priority.value = r.priority;
  form.paymentMethod.value = r.payment_method;
  form.bankingDetails.value = r.banking_details || '';
  form.paymentReference.value = r.payment_reference || '';
  form.proofOfPaymentEmail.value = r.proof_of_payment_email || '';
  form.status.value = r.status;
  form.reviewerNotes.value = r.reviewer_notes || '';
  form.actualSpent.value = r.actual_spent == null ? '' : r.actual_spent;
  form.usageNotes.value = r.usage_notes || '';
  renderBalance(r);
  renderReceipts(r);

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

function renderBalance(r) {
  const el = document.getElementById('rq-balance');
  const actualSpentInput = document.getElementById('rq-actualSpent');
  const actualSpent = actualSpentInput.value === '' ? null : parseFloat(actualSpentInput.value);
  if (actualSpent == null || Number.isNaN(actualSpent)) {
    el.textContent = 'Not yet reported';
    el.className = 'hint balance-settled';
    return;
  }
  const balance = r.amount_requested - actualSpent;
  if (Math.abs(balance) < 0.01) {
    el.textContent = 'Fully accounted for — no balance owed';
    el.className = 'hint balance-settled';
  } else if (balance > 0) {
    el.textContent = `${fmtMoney(balance)} owed back to the church`;
    el.className = 'hint balance-owed-church';
  } else {
    el.textContent = `${fmtMoney(-balance)} owed to ${r.requestor_name} (spent more than requested)`;
    el.className = 'hint balance-owed-requestor';
  }
}

function renderReceipts(r) {
  const list = document.getElementById('rq-receipts-list');
  if (!r.receipts || !r.receipts.length) {
    list.innerHTML = '<li class="hint" style="border:none; padding:4px 0;">No receipts uploaded yet.</li>';
    return;
  }
  list.innerHTML = r.receipts
    .map(
      (rec) => `
      <li>
        <span class="receipt-name">${rec.original_name || 'Receipt'}</span>
        <span class="receipt-actions">
          <a href="/api/staff/requisitions/${r.id}/receipts/${rec.id}/file" target="_blank" rel="noopener" class="btn btn-quiet btn-sm">View</a>
          <button type="button" class="btn btn-danger btn-sm receipt-delete-btn" data-receipt-id="${rec.id}">Remove</button>
        </span>
      </li>`
    )
    .join('');
  list.querySelectorAll('.receipt-delete-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this receipt?')) return;
      try {
        const updated = await api(`/api/staff/requisitions/${r.id}/receipts/${btn.dataset.receiptId}`, { method: 'DELETE' });
        Object.assign(r, updated);
        renderReceipts(r);
        toast('Receipt removed');
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
}

function wireRequisitions() {
  const dialog = document.getElementById('req-dialog');
  const form = document.getElementById('req-review-form');
  document.getElementById('rq-cancel').addEventListener('click', () => dialog.close());
  document.getElementById('rq-actualSpent').addEventListener('input', () => {
    const r = requisitionDialogRow;
    if (r) renderBalance(r);
  });
  document.getElementById('rq-receipt-upload-btn').addEventListener('click', async () => {
    const r = requisitionDialogRow;
    const fileInput = document.getElementById('rq-receipt-file');
    if (!r || !fileInput.files.length) return;
    const fd = new FormData();
    for (const file of fileInput.files) fd.append('receipts', file);
    try {
      const res = await fetch(`/api/staff/requisitions/${r.id}/receipts`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      Object.assign(r, data);
      renderReceipts(r);
      fileInput.value = '';
      toast('Receipt(s) uploaded');
    } catch (err) {
      toast(err.message, true);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = dialog.dataset.id;
    const fd = new FormData(form);
    try {
      await api(`/api/staff/requisitions/${id}`, { method: 'PATCH', body: Object.fromEntries(fd.entries()) });
      toast('Requisition updated');
      dialog.close();
      loadRequisitions();
      loadBudget();
    } catch (err) {
      toast(err.message, true);
    }
  });
  document.getElementById('rq-delete').addEventListener('click', async () => {
    const id = dialog.dataset.id;
    if (!confirm('Delete this requisition? This cannot be undone.')) return;
    try {
      await api(`/api/staff/requisitions/${id}`, { method: 'DELETE' });
      toast('Requisition deleted');
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

    const headerHtml = `
      <div class="budget-row budget-header">
        <div>Sub-Committee</div>
        <div class="num">Approved Budget</div>
        <div class="num">Actual Disbursed</div>
        <div class="num">Refunded</div>
        <div class="num">Net</div>
        <div class="num">Over/Under Spending</div>
        <div></div>
      </div>`;

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
              <div class="num"><span class="budget-col-label">Net</span>${fmtMoney(r.net)}</div>
              <div class="num ${overUnderClass}"><span class="budget-col-label">Over/Under</span>${fmtMoney(r.over_under)}</div>
              <div>${currentRole === 'admin' ? `<button class="btn btn-sm btn-quiet edit-budget-btn" data-id="${r.subcommittee_id}">Edit</button>` : ''}</div>
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
          ${headerHtml}
          ${rowsHtml}
          <div class="budget-row totals">
            <div>Subtotal</div>
            <div class="num">${fmtMoney(sub.approved)}</div>
            <div class="num">${fmtMoney(sub.disbursed)}</div>
            <div class="num">${fmtMoney(sub.refunded)}</div>
            <div class="num">${fmtMoney(sub.net)}</div>
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
        <div class="num">${fmtMoney(grand.net)}</div>
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
