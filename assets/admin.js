(() => {
  'use strict';

  const state = {
    session: null,
    data: null,
    activeTab: 'dashboard'
  };

  const els = {};
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheElements();
    VP.bindCommonControls();
    bindEvents();
    state.session = VP.getSession();
    if (state.session) {
      showAdminApp();
      await loadAdminData();
    } else {
      showAdminLogin();
    }
  }

  function cacheElements() {
    [
      'adminLoginView', 'adminAppView', 'adminLoginForm', 'adminUsername', 'adminPassword', 'adminLoginButton',
      'adminLoginError', 'adminLogoutButton', 'adminPageTitle', 'adminUserInitial', 'adminUserName', 'sidebarToggle',
      'metricUsers', 'metricTests', 'metricRequests', 'metricAssignments', 'statusSummary', 'demandSummary',
      'newUserButton', 'usersTableBody', 'newTestButton', 'testsTableBody', 'adminRequestsList', 'assignmentsList',
      'settingsForm', 'settingAppName', 'settingPublicTitle', 'settingRequestsOpen', 'settingShowRequests',
      'settingShowResolution', 'userDialog', 'userForm', 'userDialogTitle', 'userId', 'userName', 'userUsername',
      'userPasswordLabel', 'userPassword', 'userRole', 'userActiveRow', 'userActive', 'userFormError',
      'resetPasswordDialog', 'resetPasswordForm', 'resetUserId', 'resetPasswordUser', 'resetPasswordValue',
      'resetPasswordError', 'testDialog', 'testForm', 'testDialogTitle', 'testId', 'testName', 'testPlaces',
      'testOrder', 'testDescription', 'testActive', 'testRequestsOpen', 'testResolutionPublished', 'testFormError',
      'assignmentDialog', 'assignmentForm', 'assignmentDialogTitle', 'assignmentTestId', 'assignmentPlaces',
      'assignmentSelectedCount', 'assignmentPeople', 'assignmentFormError', 'adminToast'
    ].forEach(id => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.adminLoginForm.addEventListener('submit', handleLogin);
    els.adminLogoutButton.addEventListener('click', logout);
    document.querySelectorAll('[data-admin-tab]').forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.adminTab));
    });
    els.sidebarToggle.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
    els.newUserButton.addEventListener('click', openNewUser);
    els.userForm.addEventListener('submit', saveUser);
    els.resetPasswordForm.addEventListener('submit', resetPassword);
    els.newTestButton.addEventListener('click', openNewTest);
    els.testForm.addEventListener('submit', saveTest);
    els.assignmentForm.addEventListener('submit', saveAssignment);
    els.settingsForm.addEventListener('submit', saveSettings);
    window.addEventListener('online', () => { if (state.session) loadAdminData({ quiet: true }); });
  }

  async function handleLogin(event) {
    event.preventDefault();
    hideError(els.adminLoginError);
    VP.setButtonBusy(els.adminLoginButton, true, 'Accediendo…');
    try {
      const result = await VP.api('login', {
        username: els.adminUsername.value,
        password: els.adminPassword.value
      });
      if (!result.user || result.user.role !== 'admin') {
        try { await VP.api('logout', {}, { token: result.token }); } catch (_) {}
        throw new VP.VPError('FORBIDDEN', 'Esta cuenta no tiene permisos de administración.');
      }
      state.session = result;
      VP.saveSession(result);
      els.adminLoginForm.reset();
      showAdminApp();
      await loadAdminData();
    } catch (error) {
      showError(els.adminLoginError, readableError(error));
    } finally {
      VP.setButtonBusy(els.adminLoginButton, false);
    }
  }

  async function loadAdminData(options = {}) {
    try {
      state.data = await VP.api('adminGetData', {}, { token: state.session.token });
      renderAll();
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        VP.clearSession();
        state.session = null;
        showAdminLogin();
        return;
      }
      if (error.code === 'FORBIDDEN') {
        showAdminLogin('La cuenta iniciada no tiene permisos de administración.');
        return;
      }
      if (!options.quiet) VP.showToast(els.adminToast, readableError(error));
    }
  }

  function renderAll() {
    if (!state.data) return;
    const current = state.data.currentUser || state.session.user;
    els.adminUserName.textContent = current.name || 'Administrador';
    els.adminUserInitial.textContent = VP.initials(current.name).slice(0, 1);
    renderDashboard();
    renderUsers();
    renderTests();
    renderRequests();
    renderAssignments();
    renderSettings();
  }

  function renderDashboard() {
    const activeUsers = state.data.users.filter(user => user.active && user.role !== 'admin');
    const activeTests = state.data.tests.filter(test => test.active);
    els.metricUsers.textContent = String(activeUsers.length);
    els.metricTests.textContent = String(activeTests.length);
    els.metricRequests.textContent = String(state.data.requests.length);
    els.metricAssignments.textContent = String(state.data.assignments.length);

    const config = state.data.config || {};
    const statuses = [
      ['Solicitudes', configBool(config.solicitudes_globales_abiertas, true) ? 'Abiertas' : 'Cerradas', configBool(config.solicitudes_globales_abiertas, true)],
      ['Peticiones públicas', configBool(config.mostrar_solicitudes, true) ? 'Visibles' : 'Ocultas', configBool(config.mostrar_solicitudes, true)],
      ['Resolución general', configBool(config.mostrar_resolucion, false) ? 'Visible' : 'Oculta', configBool(config.mostrar_resolucion, false)]
    ];
    els.statusSummary.innerHTML = statuses.map(([label, value, positive]) => `
      <div class="status-row"><span>${VP.escapeHtml(label)}</span><strong class="status-pill ${positive ? 'positive' : 'neutral'}">${VP.escapeHtml(value)}</strong></div>
    `).join('');

    const counts = Object.fromEntries(activeTests.map(test => [test.id, 0]));
    state.data.requests.forEach(request => { if (counts[request.testId] !== undefined) counts[request.testId] += 1; });
    const demand = activeTests
      .map(test => ({ test, count: counts[test.id] || 0 }))
      .sort((a, b) => b.count - a.count || a.test.order - b.test.order)
      .slice(0, 6);
    const max = Math.max(1, ...demand.map(item => item.count));
    els.demandSummary.innerHTML = demand.length ? demand.map(item => `
      <div class="demand-row">
        <div><strong>${VP.escapeHtml(item.test.name)}</strong><span>${item.count} solicitudes · ${item.test.places || 0} plazas</span></div>
        <div class="demand-bar"><i style="width:${Math.round((item.count / max) * 100)}%"></i></div>
      </div>
    `).join('') : '<p class="empty-admin">Todavía no hay pruebas activas.</p>';
  }

  function renderUsers() {
    els.usersTableBody.innerHTML = state.data.users.map(user => `
      <tr>
        <td><div class="table-person"><span>${VP.escapeHtml(VP.initials(user.name))}</span><strong>${VP.escapeHtml(user.name)}</strong></div></td>
        <td><code>${VP.escapeHtml(user.username)}</code></td>
        <td><span class="role-badge ${user.role === 'admin' ? 'admin' : ''}">${user.role === 'admin' ? 'Administrador' : 'Participante'}</span></td>
        <td><span class="state-dot ${user.active ? 'active' : 'inactive'}">${user.active ? 'Activo' : 'Inactivo'}</span></td>
        <td class="actions-cell">
          <button class="table-action" type="button" data-edit-user="${VP.escapeHtml(user.id)}">Editar</button>
          <button class="table-action" type="button" data-reset-user="${VP.escapeHtml(user.id)}">Contraseña</button>
        </td>
      </tr>`).join('');
    els.usersTableBody.querySelectorAll('[data-edit-user]').forEach(button => button.addEventListener('click', () => openEditUser(button.dataset.editUser)));
    els.usersTableBody.querySelectorAll('[data-reset-user]').forEach(button => button.addEventListener('click', () => openResetPassword(button.dataset.resetUser)));
  }

  function openNewUser() {
    els.userForm.reset();
    hideError(els.userFormError);
    els.userDialogTitle.textContent = 'Crear usuario';
    els.userId.value = '';
    els.userPasswordLabel.hidden = false;
    els.userPassword.required = true;
    els.userPassword.value = generatePassword();
    els.userActiveRow.hidden = true;
    els.userActive.checked = true;
    els.userRole.value = 'participante';
    els.userDialog.showModal();
  }

  function openEditUser(userId) {
    const user = state.data.users.find(item => item.id === userId);
    if (!user) return;
    els.userForm.reset();
    hideError(els.userFormError);
    els.userDialogTitle.textContent = 'Editar usuario';
    els.userId.value = user.id;
    els.userName.value = user.name;
    els.userUsername.value = user.username;
    els.userRole.value = user.role;
    els.userActive.checked = user.active;
    els.userPasswordLabel.hidden = true;
    els.userPassword.required = false;
    els.userActiveRow.hidden = false;
    els.userDialog.showModal();
  }

  async function saveUser(event) {
    event.preventDefault();
    hideError(els.userFormError);
    const button = els.userForm.querySelector('[type="submit"]');
    VP.setButtonBusy(button, true, 'Guardando…');
    try {
      const id = els.userId.value;
      if (id) {
        await VP.api('adminUpdateUser', {
          userId: id,
          name: els.userName.value,
          username: els.userUsername.value,
          role: els.userRole.value,
          active: els.userActive.checked
        }, { token: state.session.token });
      } else {
        await VP.api('adminCreateUser', {
          name: els.userName.value,
          username: els.userUsername.value,
          password: els.userPassword.value,
          role: els.userRole.value
        }, { token: state.session.token });
      }
      els.userDialog.close();
      await loadAdminData({ quiet: true });
      VP.showToast(els.adminToast, id ? 'Usuario actualizado.' : 'Usuario creado.');
    } catch (error) {
      showError(els.userFormError, readableError(error));
    } finally {
      VP.setButtonBusy(button, false);
    }
  }

  function openResetPassword(userId) {
    const user = state.data.users.find(item => item.id === userId);
    if (!user) return;
    els.resetPasswordForm.reset();
    hideError(els.resetPasswordError);
    els.resetUserId.value = user.id;
    els.resetPasswordUser.textContent = `${user.name} (@${user.username})`;
    els.resetPasswordValue.value = generatePassword();
    els.resetPasswordDialog.showModal();
  }

  async function resetPassword(event) {
    event.preventDefault();
    hideError(els.resetPasswordError);
    const button = els.resetPasswordForm.querySelector('[type="submit"]');
    VP.setButtonBusy(button, true, 'Cambiando…');
    try {
      await VP.api('adminResetPassword', {
        userId: els.resetUserId.value,
        newPassword: els.resetPasswordValue.value
      }, { token: state.session.token });
      els.resetPasswordDialog.close();
      VP.showToast(els.adminToast, 'Contraseña restablecida.');
    } catch (error) {
      showError(els.resetPasswordError, readableError(error));
    } finally {
      VP.setButtonBusy(button, false);
    }
  }

  function renderTests() {
    els.testsTableBody.innerHTML = state.data.tests.map(test => `
      <tr class="${test.active ? '' : 'row-inactive'}">
        <td>${test.order}</td>
        <td><strong>${VP.escapeHtml(test.name)}</strong>${test.description ? `<small>${VP.escapeHtml(test.description)}</small>` : ''}</td>
        <td>${test.places || '—'}</td>
        <td><span class="state-dot ${test.requestsOpen ? 'active' : 'inactive'}">${test.requestsOpen ? 'Abiertas' : 'Cerradas'}</span></td>
        <td><span class="state-dot ${test.resolutionPublished ? 'active' : 'inactive'}">${test.resolutionPublished ? 'Publicada' : 'Oculta'}</span></td>
        <td><span class="state-dot ${test.active ? 'active' : 'inactive'}">${test.active ? 'Activa' : 'Inactiva'}</span></td>
        <td class="actions-cell"><button class="table-action" type="button" data-edit-test="${VP.escapeHtml(test.id)}">Editar</button></td>
      </tr>`).join('');
    els.testsTableBody.querySelectorAll('[data-edit-test]').forEach(button => button.addEventListener('click', () => openEditTest(button.dataset.editTest)));
  }

  function openNewTest() {
    els.testForm.reset();
    hideError(els.testFormError);
    els.testDialogTitle.textContent = 'Crear prueba';
    els.testId.value = '';
    els.testPlaces.value = '1';
    els.testOrder.value = String(Math.max(0, ...state.data.tests.map(test => test.order)) + 1);
    els.testActive.checked = true;
    els.testRequestsOpen.checked = true;
    els.testResolutionPublished.checked = false;
    els.testDialog.showModal();
  }

  function openEditTest(testId) {
    const test = state.data.tests.find(item => item.id === testId);
    if (!test) return;
    els.testForm.reset();
    hideError(els.testFormError);
    els.testDialogTitle.textContent = 'Editar prueba';
    els.testId.value = test.id;
    els.testName.value = test.name;
    els.testPlaces.value = String(test.places);
    els.testOrder.value = String(test.order);
    els.testDescription.value = test.description || '';
    els.testActive.checked = test.active;
    els.testRequestsOpen.checked = test.requestsOpen;
    els.testResolutionPublished.checked = test.resolutionPublished;
    els.testDialog.showModal();
  }

  async function saveTest(event) {
    event.preventDefault();
    hideError(els.testFormError);
    const button = els.testForm.querySelector('[type="submit"]');
    VP.setButtonBusy(button, true, 'Guardando…');
    try {
      const id = els.testId.value;
      const payload = {
        name: els.testName.value,
        description: els.testDescription.value,
        places: Number(els.testPlaces.value),
        requestsOpen: els.testRequestsOpen.checked
      };
      if (id) {
        Object.assign(payload, {
          testId: id,
          active: els.testActive.checked,
          resolutionPublished: els.testResolutionPublished.checked,
          order: Number(els.testOrder.value)
        });
        await VP.api('adminUpdateTest', payload, { token: state.session.token });
      } else {
        await VP.api('adminCreateTest', payload, { token: state.session.token });
      }
      els.testDialog.close();
      await loadAdminData({ quiet: true });
      VP.showToast(els.adminToast, id ? 'Prueba actualizada.' : 'Prueba creada.');
    } catch (error) {
      showError(els.testFormError, readableError(error));
    } finally {
      VP.setButtonBusy(button, false);
    }
  }

  function renderRequests() {
    const usersById = indexBy(state.data.users, 'id');
    const requestsByTest = groupBy(state.data.requests, 'testId');
    els.adminRequestsList.innerHTML = state.data.tests.filter(test => test.active).map(test => {
      const requests = requestsByTest[test.id] || [];
      const people = requests.map(request => usersById[request.userId]).filter(Boolean).sort(sortByName);
      return `
        <article class="admin-card request-admin-card">
          <div class="request-admin-heading"><div><span class="section-label">${people.length} SOLICITUDES</span><h3>${VP.escapeHtml(test.name)}</h3></div><span class="capacity-badge">${test.places || 0} plazas</span></div>
          <div class="admin-people-list">${people.length ? people.map(person => `<span><b>${VP.escapeHtml(VP.initials(person.name))}</b>${VP.escapeHtml(person.name)}</span>`).join('') : '<p class="empty-admin">Sin solicitudes.</p>'}</div>
        </article>`;
    }).join('');
  }

  function renderAssignments() {
    const usersById = indexBy(state.data.users, 'id');
    const requestsByTest = groupBy(state.data.requests, 'testId');
    const assignmentsByTest = groupBy(state.data.assignments, 'testId');
    els.assignmentsList.innerHTML = state.data.tests.filter(test => test.active).map(test => {
      const requestedCount = (requestsByTest[test.id] || []).length;
      const assigned = (assignmentsByTest[test.id] || []).map(item => usersById[item.userId]).filter(Boolean).sort(sortByName);
      return `
        <article class="admin-card assignment-admin-card">
          <div class="assignment-admin-heading">
            <div><span class="section-label">${requestedCount} SOLICITUDES · ${test.places || 0} PLAZAS</span><h3>${VP.escapeHtml(test.name)}</h3></div>
            <button class="admin-secondary" type="button" data-assign-test="${VP.escapeHtml(test.id)}">Seleccionar</button>
          </div>
          <div class="assigned-summary">${assigned.length ? assigned.map(person => `<span><b>${VP.escapeHtml(VP.initials(person.name))}</b>${VP.escapeHtml(person.name)}</span>`).join('') : '<p class="empty-admin">Nadie asignado todavía.</p>'}</div>
        </article>`;
    }).join('');
    els.assignmentsList.querySelectorAll('[data-assign-test]').forEach(button => button.addEventListener('click', () => openAssignment(button.dataset.assignTest)));
  }

  function openAssignment(testId) {
    const test = state.data.tests.find(item => item.id === testId);
    if (!test) return;
    hideError(els.assignmentFormError);
    els.assignmentTestId.value = test.id;
    els.assignmentDialogTitle.textContent = test.name;
    els.assignmentPlaces.textContent = `${test.places || 0} ${test.places === 1 ? 'plaza' : 'plazas'}`;

    const requestedIds = new Set(state.data.requests.filter(item => item.testId === test.id).map(item => item.userId));
    const assignedIds = new Set(state.data.assignments.filter(item => item.testId === test.id).map(item => item.userId));
    const users = state.data.users
      .filter(user => user.active && user.role !== 'admin')
      .sort((a, b) => Number(requestedIds.has(b.id)) - Number(requestedIds.has(a.id)) || sortByName(a, b));

    els.assignmentPeople.innerHTML = users.map(user => `
      <label class="person-option ${requestedIds.has(user.id) ? 'requested' : ''}">
        <input type="checkbox" value="${VP.escapeHtml(user.id)}" ${assignedIds.has(user.id) ? 'checked' : ''}>
        <span class="person-option-avatar">${VP.escapeHtml(VP.initials(user.name))}</span>
        <span class="person-option-copy"><strong>${VP.escapeHtml(user.name)}</strong><small>${requestedIds.has(user.id) ? 'Ha solicitado esta prueba' : 'No la ha solicitado'}</small></span>
        <span class="person-option-check">✓</span>
      </label>`).join('');
    els.assignmentPeople.querySelectorAll('input').forEach(input => input.addEventListener('change', () => handleAssignmentCount(test)));
    handleAssignmentCount(test);
    els.assignmentDialog.showModal();
  }

  function handleAssignmentCount(test) {
    const checked = Array.from(els.assignmentPeople.querySelectorAll('input:checked'));
    if (test.places > 0 && checked.length > test.places) {
      const last = checked[checked.length - 1];
      last.checked = false;
      showError(els.assignmentFormError, `Esta prueba tiene ${test.places} plazas.`);
    } else {
      hideError(els.assignmentFormError);
    }
    const count = els.assignmentPeople.querySelectorAll('input:checked').length;
    els.assignmentSelectedCount.textContent = `${count} seleccionadas`;
  }

  async function saveAssignment(event) {
    event.preventDefault();
    hideError(els.assignmentFormError);
    const button = els.assignmentForm.querySelector('[type="submit"]');
    VP.setButtonBusy(button, true, 'Guardando…');
    try {
      const userIds = Array.from(els.assignmentPeople.querySelectorAll('input:checked')).map(input => input.value);
      await VP.api('adminSetAssignments', {
        testId: els.assignmentTestId.value,
        userIds
      }, { token: state.session.token });
      els.assignmentDialog.close();
      await loadAdminData({ quiet: true });
      VP.showToast(els.adminToast, 'Asignación guardada.');
    } catch (error) {
      showError(els.assignmentFormError, readableError(error));
    } finally {
      VP.setButtonBusy(button, false);
    }
  }

  function renderSettings() {
    const config = state.data.config || {};
    els.settingAppName.value = config.app_name || 'Villa Pereza';
    els.settingPublicTitle.value = config.public_title || 'Gestión de pruebas';
    els.settingRequestsOpen.checked = configBool(config.solicitudes_globales_abiertas, true);
    els.settingShowRequests.checked = configBool(config.mostrar_solicitudes, true);
    els.settingShowResolution.checked = configBool(config.mostrar_resolucion, false);
  }

  async function saveSettings(event) {
    event.preventDefault();
    const button = els.settingsForm.querySelector('[type="submit"]');
    VP.setButtonBusy(button, true, 'Guardando…');
    try {
      await VP.api('adminUpdateConfig', {
        changes: {
          app_name: els.settingAppName.value,
          public_title: els.settingPublicTitle.value,
          solicitudes_globales_abiertas: els.settingRequestsOpen.checked,
          mostrar_solicitudes: els.settingShowRequests.checked,
          mostrar_resolucion: els.settingShowResolution.checked
        }
      }, { token: state.session.token });
      await loadAdminData({ quiet: true });
      VP.showToast(els.adminToast, 'Configuración guardada.');
    } catch (error) {
      VP.showToast(els.adminToast, readableError(error));
    } finally {
      VP.setButtonBusy(button, false);
    }
  }

  function switchTab(tab) {
    state.activeTab = tab;
    const titles = { dashboard: 'Resumen', users: 'Usuarios', tests: 'Pruebas', requests: 'Solicitudes', assignments: 'Asignaciones', settings: 'Configuración' };
    els.adminPageTitle.textContent = titles[tab] || 'Administración';
    document.querySelectorAll('[data-admin-panel]').forEach(panel => {
      const active = panel.dataset.adminPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    document.querySelectorAll('[data-admin-tab]').forEach(button => button.classList.toggle('active', button.dataset.adminTab === tab));
    document.body.classList.remove('sidebar-open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function logout() {
    const token = state.session && state.session.token;
    VP.clearSession();
    state.session = null;
    state.data = null;
    showAdminLogin();
    if (token && navigator.onLine) {
      try { await VP.api('logout', {}, { token }); } catch (_) {}
    }
  }

  function showAdminLogin(message) {
    els.adminAppView.hidden = true;
    els.adminLoginView.hidden = false;
    if (message) showError(els.adminLoginError, message);
    else hideError(els.adminLoginError);
    if (state.session && state.session.user) els.adminUsername.value = state.session.user.username || '';
  }

  function showAdminApp() {
    els.adminLoginView.hidden = true;
    els.adminAppView.hidden = false;
  }

  function configBool(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    return VP.toBoolean(value);
  }

  function groupBy(items, field) {
    return (items || []).reduce((groups, item) => {
      const key = String(item[field]);
      (groups[key] ||= []).push(item);
      return groups;
    }, {});
  }

  function indexBy(items, field) {
    return Object.fromEntries((items || []).map(item => [String(item[field]), item]));
  }

  function sortByName(a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' });
  }

  function generatePassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = new Uint32Array(14);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 100000);
    return Array.from(bytes, value => alphabet[value % alphabet.length]).join('');
  }

  function showError(element, message) {
    element.textContent = message;
    element.hidden = false;
  }

  function hideError(element) {
    element.textContent = '';
    element.hidden = true;
  }

  function readableError(error) {
    const map = {
      INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.',
      FORBIDDEN: 'Esta cuenta no tiene permisos de administración.',
      NETWORK_ERROR: 'No se ha podido conectar con el servidor.',
      TIMEOUT: 'La conexión está tardando demasiado. Inténtalo otra vez.',
      USERNAME_EXISTS: 'Ese nombre de usuario ya existe.',
      TEST_EXISTS: 'Ya existe una prueba activa con ese nombre.',
      ADMIN_SELF_LOCK: error.message,
      TOO_MANY_ASSIGNMENTS: error.message,
      VALIDATION_ERROR: error.message
    };
    return map[error.code] || error.message || 'No se ha podido completar la operación.';
  }
})();
