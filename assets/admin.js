(() => {
  'use strict';

  const POLL_MS = 1000;
  const DAY_ORDER = ['Jueves 21', 'Viernes 22', 'Sábado 23', 'Sin día asignado'];

  const state = {
    session: null,
    data: null,
    activeTab: 'dashboard',
    lastVersion: null,
    pollTimer: null,
    pollBusy: false,
    loadBusy: false
  };

  const els = {};
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheElements();
    VP.bindCommonControls();
    bindEvents();

    state.session = VP.getSession();
    if (!state.session) {
      showAdminLogin();
      return;
    }

    if (!state.session.user || state.session.user.role !== 'admin') {
      VP.clearSession();
      state.session = null;
      showAdminLogin();
      return;
    }

    showAdminApp();
    startPolling();
    if (state.session.user.mustChangePin) {
      openInitialPinDialog();
    } else {
      await loadAdminData();
    }
  }

  function cacheElements() {
    [
      'adminLoginView', 'adminAppView', 'adminLoginForm', 'adminUsername', 'adminPassword', 'adminLoginButton',
      'adminLoginError', 'adminLogoutButton', 'adminPageTitle', 'adminUserInitial', 'adminUserName', 'sidebarToggle',
      'metricUsers', 'metricTests', 'metricRequests', 'metricAssignments', 'statusSummary', 'demandSummary',
      'distributionWarnings', 'newUserButton', 'usersTableBody', 'newTestButton', 'testsTableBody',
      'adminRequestsList', 'assignmentsList', 'settingsForm', 'settingAppName', 'settingPublicTitle',
      'settingRequestsOpen', 'settingShowRequests', 'settingShowResolution', 'userDialog', 'userForm',
      'userDialogTitle', 'userId', 'userName', 'userUsername', 'userPasswordLabel', 'userPassword', 'userRole',
      'userActiveRow', 'userActive', 'userFormError', 'resetPasswordDialog', 'resetPasswordForm', 'resetUserId',
      'resetPasswordUser', 'resetPasswordValue', 'resetPasswordError', 'testDialog', 'testForm', 'testDialogTitle',
      'testId', 'testName', 'testPlaces', 'testOrder', 'testDay', 'testDescription', 'testActive',
      'testRequestsOpen', 'testResolutionPublished', 'testFormError', 'assignmentDialog', 'assignmentForm',
      'assignmentDialogTitle', 'assignmentTestId', 'assignmentPlaces', 'assignmentSelectedCount', 'assignmentPeople',
      'assignmentFormError', 'adminInitialPinDialog', 'adminInitialPinForm', 'adminInitialPin',
      'adminInitialPinRepeat', 'adminInitialPinError', 'adminInitialPinButton', 'adminToast'
    ].forEach(id => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.adminLoginForm.addEventListener('submit', handleLogin);
    els.adminLogoutButton.addEventListener('click', logout);

    document.querySelectorAll('[data-admin-tab]').forEach(button => {
      button.addEventListener('click', () => {
        switchTab(button.dataset.adminTab);
        queueVersionCheck(40);
      });
    });

    els.sidebarToggle.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
    els.newUserButton.addEventListener('click', openNewUser);
    els.userForm.addEventListener('submit', saveUser);
    els.resetPasswordForm.addEventListener('submit', resetPin);
    els.newTestButton.addEventListener('click', openNewTest);
    els.testForm.addEventListener('submit', saveTest);
    els.assignmentForm.addEventListener('submit', saveAssignment);
    els.settingsForm.addEventListener('submit', saveSettings);
    els.adminInitialPinForm.addEventListener('submit', changeInitialPin);
    els.adminInitialPinDialog.addEventListener('cancel', event => event.preventDefault());

    window.addEventListener('online', () => { if (state.session) checkVersionNow(); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.session) checkVersionNow();
    });
    document.addEventListener('click', event => {
      if (event.target.closest('button, a, [role="button"]')) queueVersionCheck(80);
    });
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
      startPolling();

      if (result.user.mustChangePin) {
        openInitialPinDialog();
      } else {
        await loadAdminData();
      }
    } catch (error) {
      showError(els.adminLoginError, readableError(error));
    } finally {
      VP.setButtonBusy(els.adminLoginButton, false);
    }
  }

  async function loadAdminData(options = {}) {
    if (!state.session || state.loadBusy || (state.session.user && state.session.user.mustChangePin)) return;
    state.loadBusy = true;

    try {
      state.data = await VP.api('adminGetData', {}, { token: state.session.token });
      const configVersion = state.data.config && state.data.config.version_datos;
      state.lastVersion = String(configVersion || state.lastVersion || '');
      renderAll();
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        VP.clearSession();
        state.session = null;
        stopPolling();
        showAdminLogin();
        return;
      }
      if (error.code === 'PIN_CHANGE_REQUIRED') {
        markPinChangeRequired();
        return;
      }
      if (error.code === 'FORBIDDEN') {
        showAdminLogin('La cuenta iniciada no tiene permisos de administración.');
        return;
      }
      if (!options.quiet) VP.showToast(els.adminToast, readableError(error));
    } finally {
      state.loadBusy = false;
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
    const activeUsers = participantUsers();
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
      <div class="status-row">
        <span>${VP.escapeHtml(label)}</span>
        <strong class="status-pill ${positive ? 'positive' : 'neutral'}">${VP.escapeHtml(value)}</strong>
      </div>`).join('');

    const requestsByTest = groupBy(state.data.requests, 'testId');
    els.demandSummary.innerHTML = activeTests.length
      ? activeTests.map(test => {
          const count = (requestsByTest[test.id] || []).length;
          const status = capacityStatus(count, test.places);
          return `
            <div class="demand-row capacity-${status.key}">
              <div>
                <strong>${VP.escapeHtml(test.name)}</strong>
                <span>${VP.escapeHtml(dayLabel(test.day))} · ${count}/${test.places || '∞'} solicitudes</span>
              </div>
              <b class="capacity-admin-label">${VP.escapeHtml(status.label)}</b>
            </div>`;
        }).join('')
      : '<p class="empty-admin">Todavía no hay pruebas activas.</p>';

    const counts = assignmentCounts();
    els.distributionWarnings.innerHTML = activeUsers.length
      ? activeUsers
          .sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0) || sortByName(a, b))
          .map(user => {
            const count = counts[user.id] || 0;
            const status = count < 2 ? 'low' : count > 4 ? 'high' : 'ok';
            const message = count < 2
              ? `Le ${count === 1 ? 'falta 1 prueba' : `faltan ${2 - count} pruebas`}`
              : count > 4
                ? `Tiene ${count - 4} de más`
                : 'Dentro del intervalo';
            return `
              <div class="distribution-row ${status}">
                <div class="table-person"><span>${VP.escapeHtml(VP.initials(user.name))}</span><strong>${VP.escapeHtml(user.name)}</strong></div>
                <div><b>${count} pruebas</b><small>${VP.escapeHtml(message)}</small></div>
              </div>`;
          }).join('')
      : '<p class="empty-admin">No hay participantes activos.</p>';
  }

  function renderUsers() {
    els.usersTableBody.innerHTML = state.data.users.map(user => `
      <tr>
        <td><div class="table-person"><span>${VP.escapeHtml(VP.initials(user.name))}</span><strong>${VP.escapeHtml(user.name)}</strong></div></td>
        <td><code>${VP.escapeHtml(user.username)}</code></td>
        <td><span class="role-badge ${user.role === 'admin' ? 'admin' : ''}">${user.role === 'admin' ? 'Administrador' : 'Participante'}</span></td>
        <td>
          <span class="state-dot ${user.active ? 'active' : 'inactive'}">${user.active ? 'Activo' : 'Inactivo'}</span>
          ${user.mustChangePin ? '<small class="pin-pending">PIN temporal</small>' : ''}
        </td>
        <td class="actions-cell">
          <button class="table-action" type="button" data-edit-user="${VP.escapeHtml(user.id)}">Editar</button>
          <button class="table-action" type="button" data-reset-user="${VP.escapeHtml(user.id)}">PIN</button>
        </td>
      </tr>`).join('');

    els.usersTableBody.querySelectorAll('[data-edit-user]').forEach(button => {
      button.addEventListener('click', () => openEditUser(button.dataset.editUser));
    });
    els.usersTableBody.querySelectorAll('[data-reset-user]').forEach(button => {
      button.addEventListener('click', () => openResetPin(button.dataset.resetUser));
    });
  }

  function openNewUser() {
    els.userForm.reset();
    hideError(els.userFormError);
    els.userDialogTitle.textContent = 'Crear usuario';
    els.userId.value = '';
    els.userPasswordLabel.hidden = false;
    els.userPassword.required = true;
    els.userPassword.value = generatePin();
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
        if (!isValidPin(els.userPassword.value)) {
          throw new VP.VPError('VALIDATION_ERROR', 'El PIN inicial debe tener exactamente 4 cifras.');
        }
        await VP.api('adminCreateUser', {
          name: els.userName.value,
          username: els.userUsername.value,
          pin: els.userPassword.value,
          role: els.userRole.value
        }, { token: state.session.token });
      }

      els.userDialog.close();
      await loadAdminData({ quiet: true });
      VP.showToast(els.adminToast, id ? 'Usuario actualizado.' : 'Usuario creado con PIN temporal.');
    } catch (error) {
      showError(els.userFormError, readableError(error));
    } finally {
      VP.setButtonBusy(button, false);
    }
  }

  function openResetPin(userId) {
    const user = state.data.users.find(item => item.id === userId);
    if (!user) return;

    els.resetPasswordForm.reset();
    hideError(els.resetPasswordError);
    els.resetUserId.value = user.id;
    els.resetPasswordUser.textContent = `${user.name} (@${user.username})`;
    els.resetPasswordValue.value = generatePin();
    els.resetPasswordDialog.showModal();
  }

  async function resetPin(event) {
    event.preventDefault();
    hideError(els.resetPasswordError);
    const button = els.resetPasswordForm.querySelector('[type="submit"]');
    VP.setButtonBusy(button, true, 'Cambiando…');

    try {
      if (!isValidPin(els.resetPasswordValue.value)) {
        throw new VP.VPError('VALIDATION_ERROR', 'El PIN debe tener exactamente 4 cifras.');
      }

      await VP.api('adminResetPin', {
        userId: els.resetUserId.value,
        newPin: els.resetPasswordValue.value
      }, { token: state.session.token });

      els.resetPasswordDialog.close();
      await loadAdminData({ quiet: true });
      VP.showToast(els.adminToast, 'PIN restablecido. Se pedirá cambiarlo al entrar.');
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
        <td><span class="day-badge">${VP.escapeHtml(dayLabel(test.day))}</span></td>
        <td>${test.places || '—'}</td>
        <td><span class="state-dot ${test.requestsOpen ? 'active' : 'inactive'}">${test.requestsOpen ? 'Abiertas' : 'Cerradas'}</span></td>
        <td><span class="state-dot ${test.resolutionPublished ? 'active' : 'inactive'}">${test.resolutionPublished ? 'Publicada' : 'Oculta'}</span></td>
        <td><span class="state-dot ${test.active ? 'active' : 'inactive'}">${test.active ? 'Activa' : 'Inactiva'}</span></td>
        <td class="actions-cell"><button class="table-action" type="button" data-edit-test="${VP.escapeHtml(test.id)}">Editar</button></td>
      </tr>`).join('');

    els.testsTableBody.querySelectorAll('[data-edit-test]').forEach(button => {
      button.addEventListener('click', () => openEditTest(button.dataset.editTest));
    });
  }

  function openNewTest() {
    els.testForm.reset();
    hideError(els.testFormError);
    els.testDialogTitle.textContent = 'Crear prueba';
    els.testId.value = '';
    els.testPlaces.value = '1';
    els.testOrder.value = String(Math.max(0, ...state.data.tests.map(test => test.order)) + 1);
    els.testDay.value = '';
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
    els.testDay.value = test.day || '';
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
      if (els.testResolutionPublished.checked && distributionIssues().length) {
        const proceed = window.confirm(buildDistributionWarning('La resolución todavía deja personas fuera del intervalo de 2 a 4 pruebas.'));
        if (!proceed) return;
      }

      const payload = {
        name: els.testName.value,
        description: els.testDescription.value,
        places: Number(els.testPlaces.value),
        day: els.testDay.value,
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
      const status = capacityStatus(people.length, test.places);

      return `
        <article class="admin-card request-admin-card capacity-${status.key}">
          <div class="request-admin-heading">
            <div>
              <span class="section-label">${VP.escapeHtml(dayLabel(test.day).toUpperCase())}</span>
              <h3>${VP.escapeHtml(test.name)}</h3>
              <small>${people.length} solicitudes · ${test.places || 0} plazas</small>
            </div>
            <span class="capacity-badge">${VP.escapeHtml(status.label)}</span>
          </div>
          <div class="admin-people-list">
            ${people.length
              ? people.map(person => `<span><b>${VP.escapeHtml(VP.initials(person.name))}</b>${VP.escapeHtml(person.name)}</span>`).join('')
              : '<p class="empty-admin">Sin solicitudes.</p>'}
          </div>
        </article>`;
    }).join('');
  }

  function renderAssignments() {
    const usersById = indexBy(state.data.users, 'id');
    const requestsByTest = groupBy(state.data.requests, 'testId');
    const assignmentsByTest = groupBy(state.data.assignments, 'testId');

    els.assignmentsList.innerHTML = state.data.tests.filter(test => test.active).map(test => {
      const requestedCount = (requestsByTest[test.id] || []).length;
      const assigned = (assignmentsByTest[test.id] || [])
        .map(item => usersById[item.userId])
        .filter(Boolean)
        .sort(sortByName);
      const assignmentStatus = capacityStatus(assigned.length, test.places);

      return `
        <article class="admin-card assignment-admin-card capacity-${assignmentStatus.key}">
          <div class="assignment-admin-heading">
            <div>
              <span class="section-label">${VP.escapeHtml(dayLabel(test.day).toUpperCase())}</span>
              <h3>${VP.escapeHtml(test.name)}</h3>
              <small>${requestedCount} solicitudes · ${assigned.length}/${test.places || '∞'} asignadas</small>
            </div>
            <button class="admin-secondary" type="button" data-assign-test="${VP.escapeHtml(test.id)}">Seleccionar</button>
          </div>
          <div class="assignment-capacity-label">${VP.escapeHtml(assignmentStatus.label)}</div>
          <div class="assigned-summary">
            ${assigned.length
              ? assigned.map(person => `<span><b>${VP.escapeHtml(VP.initials(person.name))}</b>${VP.escapeHtml(person.name)}</span>`).join('')
              : '<p class="empty-admin">Nadie asignado todavía.</p>'}
          </div>
        </article>`;
    }).join('');

    els.assignmentsList.querySelectorAll('[data-assign-test]').forEach(button => {
      button.addEventListener('click', () => openAssignment(button.dataset.assignTest));
    });
  }

  function openAssignment(testId) {
    const test = state.data.tests.find(item => item.id === testId);
    if (!test) return;

    hideError(els.assignmentFormError);
    els.assignmentTestId.value = test.id;
    els.assignmentDialogTitle.textContent = test.name;
    els.assignmentPlaces.textContent = `${dayLabel(test.day)} · ${test.places || 0} ${test.places === 1 ? 'plaza' : 'plazas'}`;

    const requestedIds = new Set(
      state.data.requests.filter(item => item.testId === test.id).map(item => item.userId)
    );
    const assignedIds = new Set(
      state.data.assignments.filter(item => item.testId === test.id).map(item => item.userId)
    );
    const counts = assignmentCounts();

    const users = participantUsers()
      .sort((a, b) => Number(requestedIds.has(b.id)) - Number(requestedIds.has(a.id)) || sortByName(a, b));

    const requested = users.filter(user => requestedIds.has(user.id));
    const notRequested = users.filter(user => !requestedIds.has(user.id));

    els.assignmentPeople.innerHTML = `
      ${peopleSelectorGroup('La han solicitado', requested, requestedIds, assignedIds, counts)}
      ${peopleSelectorGroup('No la han solicitado', notRequested, requestedIds, assignedIds, counts)}
    `;

    els.assignmentPeople.querySelectorAll('input').forEach(input => {
      input.addEventListener('change', () => handleAssignmentCount(test));
    });
    handleAssignmentCount(test);
    els.assignmentDialog.showModal();
  }

  function peopleSelectorGroup(title, users, requestedIds, assignedIds, counts) {
    if (!users.length) return '';
    return `
      <section class="people-selector-group">
        <h3>${VP.escapeHtml(title)}</h3>
        ${users.map(user => `
          <label class="person-option ${requestedIds.has(user.id) ? 'requested' : 'not-requested'}">
            <input type="checkbox" value="${VP.escapeHtml(user.id)}" ${assignedIds.has(user.id) ? 'checked' : ''}>
            <span class="person-option-avatar">${VP.escapeHtml(VP.initials(user.name))}</span>
            <span class="person-option-copy">
              <strong>${VP.escapeHtml(user.name)}</strong>
              <small>${requestedIds.has(user.id) ? 'Ha solicitado esta prueba' : 'Asignación directa'} · ${counts[user.id] || 0} pruebas actuales</small>
            </span>
            <span class="person-option-check">✓</span>
          </label>`).join('')}
      </section>`;
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
    const status = capacityStatus(count, test.places);
    els.assignmentSelectedCount.textContent = `${count} seleccionadas · ${status.label}`;
  }

  async function saveAssignment(event) {
    event.preventDefault();
    hideError(els.assignmentFormError);
    const button = els.assignmentForm.querySelector('[type="submit"]');
    VP.setButtonBusy(button, true, 'Guardando…');

    try {
      const testId = els.assignmentTestId.value;
      const userIds = Array.from(els.assignmentPeople.querySelectorAll('input:checked')).map(input => input.value);
      const projected = projectedAssignmentIssues(testId, userIds);
      const overLimit = projected.filter(issue => issue.count > 4);

      if (overLimit.length) {
        const names = overLimit.map(issue => `${issue.user.name} (${issue.count})`).join(', ');
        const proceed = window.confirm(`Aviso: estas personas superarían las 4 pruebas: ${names}.\n\n¿Guardar de todos modos?`);
        if (!proceed) return;
      }

      await VP.api('adminSetAssignments', { testId, userIds }, { token: state.session.token });
      els.assignmentDialog.close();
      await loadAdminData({ quiet: true });

      const issues = distributionIssues();
      VP.showToast(
        els.adminToast,
        issues.length ? `Asignación guardada. Hay ${issues.length} personas fuera del intervalo 2–4.` : 'Asignación guardada. Todo el mundo está entre 2 y 4 pruebas.',
        4200
      );
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
      const currentlyVisible = configBool((state.data.config || {}).mostrar_resolucion, false);
      if (!currentlyVisible && els.settingShowResolution.checked && distributionIssues().length) {
        const proceed = window.confirm(buildDistributionWarning('Vas a publicar la resolución con personas fuera del intervalo de 2 a 4 pruebas.'));
        if (!proceed) return;
      }

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

  async function changeInitialPin(event) {
    event.preventDefault();
    hideError(els.adminInitialPinError);

    if (!isValidPin(els.adminInitialPin.value)) {
      showError(els.adminInitialPinError, 'El PIN debe tener exactamente 4 cifras.');
      return;
    }
    if (els.adminInitialPin.value !== els.adminInitialPinRepeat.value) {
      showError(els.adminInitialPinError, 'Los dos PIN no coinciden.');
      return;
    }

    VP.setButtonBusy(els.adminInitialPinButton, true, 'Guardando…');
    try {
      const result = await VP.api('changeInitialPin', {
        newPin: els.adminInitialPin.value
      }, { token: state.session.token });

      state.session.user = result.user || Object.assign({}, state.session.user, { mustChangePin: false });
      state.session.user.mustChangePin = false;
      VP.saveSession(state.session);
      els.adminInitialPinDialog.close();
      els.adminInitialPinForm.reset();
      await loadAdminData();
    } catch (error) {
      showError(els.adminInitialPinError, readableError(error));
    } finally {
      VP.setButtonBusy(els.adminInitialPinButton, false);
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(checkVersionNow, POLL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function queueVersionCheck(delay = 0) {
    window.clearTimeout(state._queuedVersionCheck);
    state._queuedVersionCheck = window.setTimeout(checkVersionNow, delay);
  }

  async function checkVersionNow() {
    if (!state.session || state.pollBusy || !navigator.onLine || (state.session.user && state.session.user.mustChangePin)) return;
    state.pollBusy = true;

    try {
      const result = await VP.api('getVersion', {}, { token: state.session.token });
      const version = String(result.dataVersion || '');
      if (state.lastVersion === null) state.lastVersion = version;
      if (version && version !== String(state.lastVersion || '')) {
        await loadAdminData({ quiet: true });
      }
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        VP.clearSession();
        state.session = null;
        stopPolling();
        showAdminLogin();
      }
      if (error.code === 'PIN_CHANGE_REQUIRED') markPinChangeRequired();
    } finally {
      state.pollBusy = false;
    }
  }

  function switchTab(tab) {
    state.activeTab = tab;
    const titles = {
      dashboard: 'Resumen',
      users: 'Usuarios',
      tests: 'Pruebas',
      requests: 'Solicitudes',
      assignments: 'Asignaciones',
      settings: 'Configuración'
    };
    els.adminPageTitle.textContent = titles[tab] || 'Administración';

    document.querySelectorAll('[data-admin-panel]').forEach(panel => {
      const active = panel.dataset.adminPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    document.querySelectorAll('[data-admin-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.adminTab === tab);
    });
    document.body.classList.remove('sidebar-open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function logout() {
    const token = state.session && state.session.token;
    VP.clearSession();
    state.session = null;
    state.data = null;
    state.lastVersion = null;
    stopPolling();
    showAdminLogin();

    if (token && navigator.onLine) {
      try { await VP.api('logout', {}, { token }); } catch (_) {}
    }
  }

  function participantUsers() {
    return (state.data.users || []).filter(user => user.active && user.role !== 'admin');
  }

  function assignmentCounts(assignments = state.data.assignments) {
    const counts = Object.fromEntries(participantUsers().map(user => [user.id, 0]));
    (assignments || []).forEach(item => {
      if (counts[item.userId] !== undefined) counts[item.userId] += 1;
    });
    return counts;
  }

  function projectedAssignmentIssues(testId, selectedUserIds) {
    const selected = new Set(selectedUserIds);
    const projected = state.data.assignments
      .filter(item => item.testId !== testId)
      .concat(Array.from(selected).map(userId => ({ testId, userId })));
    const counts = assignmentCounts(projected);

    return participantUsers().map(user => ({
      user,
      count: counts[user.id] || 0
    })).filter(item => item.count < 2 || item.count > 4);
  }

  function distributionIssues() {
    const counts = assignmentCounts();
    return participantUsers().map(user => ({
      user,
      count: counts[user.id] || 0
    })).filter(item => item.count < 2 || item.count > 4);
  }

  function buildDistributionWarning(prefix) {
    const issues = distributionIssues();
    const detail = issues.slice(0, 12).map(issue => `${issue.user.name}: ${issue.count}`).join('\n');
    const rest = issues.length > 12 ? `\n…y ${issues.length - 12} personas más.` : '';
    return `${prefix}\n\n${detail}${rest}\n\n¿Continuar?`;
  }

  function capacityStatus(count, places) {
    places = Number(places);
    if (!Number.isFinite(places) || places <= 0) return { key: 'neutral', label: 'Sin cupo definido' };
    if (count < places) return { key: 'shortage', label: `Faltan ${places - count}` };
    if (count > places) return { key: 'surplus', label: `Sobran ${count - places}` };
    return { key: 'complete', label: 'Cupo completo' };
  }

  function dayLabel(day) {
    return day && DAY_ORDER.includes(day) ? day : 'Sin día asignado';
  }

  function markPinChangeRequired() {
    if (!state.session) return;
    state.session.user ||= {};
    state.session.user.mustChangePin = true;
    VP.saveSession(state.session);
    openInitialPinDialog();
  }

  function openInitialPinDialog() {
    showAdminApp();
    els.adminInitialPinForm.reset();
    hideError(els.adminInitialPinError);
    if (!els.adminInitialPinDialog.open) els.adminInitialPinDialog.showModal();
    window.setTimeout(() => els.adminInitialPin.focus(), 50);
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

  function generatePin() {
    const bytes = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return String(1000 + (bytes[0] % 9000));
    }
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  function isValidPin(value) {
    return /^\d{4}$/.test(String(value || ''));
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
      INVALID_CREDENTIALS: 'Usuario o PIN incorrectos.',
      FORBIDDEN: 'Esta cuenta no tiene permisos de administración.',
      NETWORK_ERROR: 'No se ha podido conectar con el servidor.',
      TIMEOUT: 'La conexión está tardando demasiado. Inténtalo otra vez.',
      USERNAME_EXISTS: 'Ese nombre de usuario ya existe.',
      TEST_EXISTS: 'Ya existe una prueba activa con ese nombre.',
      ADMIN_SELF_LOCK: error.message,
      TOO_MANY_ASSIGNMENTS: error.message,
      PIN_CHANGE_REQUIRED: 'Debes cambiar el PIN temporal antes de continuar.',
      VALIDATION_ERROR: error.message
    };
    return map[error.code] || error.message || 'No se ha podido completar la operación.';
  }
})();