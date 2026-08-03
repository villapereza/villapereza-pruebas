(() => {
  'use strict';

  const POLL_MS = 1000;
  const DAY_ORDER = ['Jueves 21', 'Viernes 22', 'Sábado 23', 'Sin día asignado'];

  const state = {
    session: null,
    data: null,
    selectedIds: new Set(),
    savingTimer: null,
    activeTab: 'tests',
    resolutionView: 'tests',
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
    registerServiceWorker();

    state.session = VP.getSession();
    if (!state.session) {
      showLogin();
      return;
    }

    showApp();
    startPolling();
    if (state.session.user && state.session.user.mustChangePin) {
      openInitialPinDialog();
    } else {
      await loadData();
    }
  }

  function cacheElements() {
    [
      'loginView', 'appView', 'loginForm', 'loginUsername', 'loginPassword', 'loginButton', 'loginError',
      'publicTitle', 'profileInitial', 'testsList', 'testsEmpty', 'selectedCount', 'requestsClosedBanner',
      'requestersList', 'requestsHidden', 'resolutionList', 'resolutionHidden', 'mineAvatar', 'mineName',
      'mineUsername', 'mineRequested', 'mineAssigned', 'profileButton', 'logoutButton', 'changePasswordButton',
      'passwordDialog', 'passwordForm', 'currentPassword', 'newPassword', 'repeatPassword', 'passwordError',
      'initialPinDialog', 'initialPinForm', 'initialPin', 'initialPinRepeat', 'initialPinError', 'initialPinButton',
      'toast'
    ].forEach(id => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.loginForm.addEventListener('submit', handleLogin);

    document.querySelectorAll('[data-tab]').forEach(button => {
      button.addEventListener('click', () => {
        switchTab(button.dataset.tab);
        queueVersionCheck(40);
      });
    });

    document.querySelectorAll('[data-resolution-view]').forEach(button => {
      button.addEventListener('click', () => {
        state.resolutionView = button.dataset.resolutionView;
        document.querySelectorAll('[data-resolution-view]').forEach(item => {
          item.classList.toggle('active', item.dataset.resolutionView === state.resolutionView);
        });
        renderResolution();
        queueVersionCheck(40);
      });
    });

    els.profileButton.addEventListener('click', () => switchTab('mine'));
    els.logoutButton.addEventListener('click', logout);
    els.changePasswordButton.addEventListener('click', () => {
      els.passwordForm.reset();
      hideError(els.passwordError);
      els.passwordDialog.showModal();
    });
    els.passwordForm.addEventListener('submit', changePin);
    els.initialPinForm.addEventListener('submit', changeInitialPin);
    els.initialPinDialog.addEventListener('cancel', event => event.preventDefault());

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.session) checkVersionNow();
    });

    document.addEventListener('click', event => {
      if (event.target.closest('button, a, [role="button"]')) queueVersionCheck(80);
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    hideError(els.loginError);
    VP.setButtonBusy(els.loginButton, true, 'Entrando…');

    try {
      const result = await VP.api('login', {
        username: els.loginUsername.value,
        password: els.loginPassword.value
      });
      state.session = result;
      VP.saveSession(result);
      els.loginForm.reset();
      showApp();
      startPolling();

      if (result.user && result.user.mustChangePin) {
        openInitialPinDialog();
      } else {
        await loadData();
      }
    } catch (error) {
      showError(els.loginError, readableError(error));
    } finally {
      VP.setButtonBusy(els.loginButton, false);
    }
  }

  async function loadData(options = {}) {
    if (!state.session || state.loadBusy || (state.session.user && state.session.user.mustChangePin)) return;
    state.loadBusy = true;
    let data = null;

    try {
      if (options.flushFirst !== false) {
        try {
          await VP.flushMyRequests(state.session.token);
        } catch (error) {
          if (error.code === 'UNAUTHORIZED' || error.code === 'PIN_CHANGE_REQUIRED') throw error;
        }
      }

      data = await VP.api('getPublicData', {}, { token: state.session.token });
      VP.savePublicCache(data);
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        endSession();
        return;
      }
      if (error.code === 'PIN_CHANGE_REQUIRED') {
        markPinChangeRequired();
        return;
      }

      data = VP.getPublicCache();
      if (!data) {
        if (!options.quiet) VP.showToast(els.toast, 'No se han podido cargar los datos. Comprueba la conexión.');
        return;
      }
    } finally {
      state.loadBusy = false;
    }

    state.data = data;
    state.lastVersion = String(data.dataVersion || state.lastVersion || '');
    const queued = await VP.getQueuedRequests();
    const localSelection = VP.getLocalSelection();
    state.selectedIds = new Set(
      queued && localSelection.length
        ? localSelection
        : (data.myRequestTestIds || []).map(String)
    );
    renderAll();
  }

  function renderAll() {
    if (!state.data) return;
    const user = state.data.currentUser || state.session.user;
    const config = state.data.config || {};

    els.publicTitle.textContent = config.publicTitle || 'Gestión de pruebas';
    els.profileInitial.textContent = VP.initials(user.name).slice(0, 1);
    els.mineAvatar.textContent = VP.initials(user.name);
    els.mineName.textContent = user.name || 'Integrante';
    els.mineUsername.textContent = `@${user.username || ''}`;

    renderTests();
    renderRequests();
    renderResolution();
    renderMine();
    updateTabAvailability();
  }

  function renderTests() {
    const tests = state.data.tests || [];
    const globallyOpen = state.data.config && state.data.config.requestsGloballyOpen !== false;
    const showRequests = state.data.config && state.data.config.showRequests !== false;
    const currentUserId = String((state.data.currentUser || {}).id || '');

    els.requestsClosedBanner.hidden = globallyOpen;
    els.testsEmpty.hidden = tests.length > 0;

    els.testsList.innerHTML = tests.map((test, index) => {
      const id = String(test.id);
      const selected = state.selectedIds.has(id);
      const enabled = globallyOpen && test.requestsOpen;
      const serverPeople = Array.isArray(test.requesters) ? test.requesters : [];
      const serverHasCurrent = serverPeople.some(person => String(person.id) === currentUserId);
      const applicantCount = Math.max(0, serverPeople.length + (selected && !serverHasCurrent ? 1 : 0) - (!selected && serverHasCurrent ? 1 : 0));
      const otherPeople = serverPeople.filter(person => String(person.id) !== currentUserId);
      const status = capacityStatus(applicantCount, Number(test.places));
      const placesText = Number(test.places) > 0
        ? `${test.places} ${Number(test.places) === 1 ? 'plaza' : 'plazas'}`
        : 'Sin límite indicado';
      const requesterText = showRequests
        ? requesterPreview(otherPeople)
        : '';

      return `
        <article class="test-card ${selected ? 'selected' : ''} ${enabled ? '' : 'locked'} capacity-${status.key}" style="--card-index:${index}">
          <label class="test-selector">
            <input class="test-checkbox" type="checkbox" data-test-id="${VP.escapeHtml(test.id)}" ${selected ? 'checked' : ''} ${enabled ? '' : 'disabled'}>
            <span class="custom-check" aria-hidden="true">✓</span>
            <span class="test-main">
              <span class="test-title-row">
                <strong>${VP.escapeHtml(test.name)}</strong>
                <span class="place-pill">${VP.escapeHtml(placesText)}</span>
              </span>
              <span class="test-day">${VP.escapeHtml(dayLabel(test.day))}</span>
              ${test.description ? `<span class="test-description">${VP.escapeHtml(test.description)}</span>` : ''}
              <span class="capacity-line">
                <b class="capacity-state">${VP.escapeHtml(status.label)}</b>
                <span>${applicantCount} ${applicantCount === 1 ? 'solicitud' : 'solicitudes'}</span>
              </span>
              ${showRequests ? `<span class="requester-preview">${VP.escapeHtml(requesterText)}</span>` : ''}
              ${enabled ? '' : '<span class="test-closed">Solicitudes cerradas</span>'}
            </span>
          </label>
        </article>`;
    }).join('');

    els.testsList.querySelectorAll('.test-checkbox').forEach(input => {
      input.addEventListener('change', handleSelectionChange);
    });
    updateSelectedCount();
  }

  function handleSelectionChange(event) {
    const id = String(event.currentTarget.dataset.testId);
    if (event.currentTarget.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);

    updateSelectedCount();
    persistSelection();
    renderTests();
    renderMine();
    queueVersionCheck(250);
  }

  function updateSelectedCount() {
    els.selectedCount.textContent = String(state.selectedIds.size);
  }

  function persistSelection() {
    const ids = Array.from(state.selectedIds);
    VP.saveLocalSelection(ids);
    window.clearTimeout(state.savingTimer);

    state.savingTimer = window.setTimeout(async () => {
      try {
        await VP.queueMyRequests(ids);
        if (state.session && navigator.onLine) {
          await VP.flushMyRequests(state.session.token);
          await loadData({ flushFirst: false, quiet: true });
        }
      } catch (error) {
        if (error.code === 'UNAUTHORIZED') endSession();
        if (error.code === 'PIN_CHANGE_REQUIRED') markPinChangeRequired();
        if (['REQUESTS_CLOSED', 'TEST_CLOSED'].includes(error.code)) {
          VP.showToast(els.toast, error.message);
          await loadData({ flushFirst: false });
        }
      }
    }, 120);
  }

  function renderRequests() {
    const visible = state.data.config && state.data.config.showRequests !== false;
    els.requestsHidden.hidden = visible;
    els.requestersList.hidden = !visible;
    if (!visible) return;

    els.requestersList.innerHTML = (state.data.tests || []).map(test => {
      const people = test.requesters || [];
      const status = capacityStatus(people.length, Number(test.places));
      return `
        <article class="people-card capacity-${status.key}">
          <div class="people-card-heading">
            <div>
              <span class="small-label">${VP.escapeHtml(dayLabel(test.day).toUpperCase())}</span>
              <h3>${VP.escapeHtml(test.name)}</h3>
            </div>
            <span class="count-badge">${people.length}/${test.places || '∞'}</span>
          </div>
          <div class="capacity-summary"><strong>${VP.escapeHtml(status.label)}</strong></div>
          <div class="people-list">
            ${people.length
              ? people.map(person => `<span class="person-chip"><b>${VP.escapeHtml(VP.initials(person.name))}</b>${VP.escapeHtml(person.name)}</span>`).join('')
              : '<p class="muted-copy">Todavía no la ha solicitado nadie.</p>'}
          </div>
        </article>`;
    }).join('');
  }

  function renderResolution() {
    const configVisible = state.data.config && state.data.config.showResolution === true;
    const publishedTests = (state.data.tests || []).filter(test => test.resolutionPublished);
    const visible = configVisible && publishedTests.length > 0;
    els.resolutionHidden.hidden = visible;
    els.resolutionList.hidden = !visible;
    if (!visible) return;

    els.resolutionList.innerHTML = state.resolutionView === 'people'
      ? renderResolutionByPeople(publishedTests)
      : renderResolutionByTests(publishedTests);
  }

  function renderResolutionByTests(tests) {
    const groups = groupTestsByDay(tests);
    return DAY_ORDER
      .filter(day => groups[day] && groups[day].length)
      .map(day => `
        <section class="day-group">
          <div class="day-heading"><span>${VP.escapeHtml(day)}</span></div>
          <div class="day-card-list">
            ${groups[day].map((test, index) => {
              const people = test.assigned || [];
              return `
                <article class="resolution-card" style="--card-index:${index}">
                  <div class="resolution-star">★</div>
                  <span class="small-label">EQUIPO DEFINITIVO</span>
                  <h3>${VP.escapeHtml(test.name)}</h3>
                  <div class="resolved-people">
                    ${people.length
                      ? people.map(person => `<span><b>${VP.escapeHtml(VP.initials(person.name))}</b>${VP.escapeHtml(person.name)}</span>`).join('')
                      : '<p class="muted-copy">No hay participantes asignadas.</p>'}
                  </div>
                </article>`;
            }).join('')}
          </div>
        </section>`)
      .join('');
  }

  function renderResolutionByPeople(tests) {
    const peopleByDay = {};
    tests.forEach(test => {
      const day = normalizedDay(test.day);
      (test.assigned || []).forEach(person => {
        peopleByDay[day] ||= {};
        const key = String(person.id || person.name);
        peopleByDay[day][key] ||= { person, tests: [] };
        peopleByDay[day][key].tests.push(test);
      });
    });

    return DAY_ORDER
      .filter(day => peopleByDay[day] && Object.keys(peopleByDay[day]).length)
      .map(day => {
        const entries = Object.values(peopleByDay[day])
          .sort((a, b) => String(a.person.name).localeCompare(String(b.person.name), 'es', { sensitivity: 'base' }));
        return `
          <section class="day-group">
            <div class="day-heading"><span>${VP.escapeHtml(day)}</span></div>
            <div class="person-resolution-list">
              ${entries.map(entry => `
                <article class="person-resolution-card">
                  <div class="person-resolution-head">
                    <b>${VP.escapeHtml(VP.initials(entry.person.name))}</b>
                    <strong>${VP.escapeHtml(entry.person.name)}</strong>
                  </div>
                  <div class="person-test-tags">
                    ${entry.tests.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es')).map(test => `<span>${VP.escapeHtml(test.name)}</span>`).join('')}
                  </div>
                </article>`).join('')}
            </div>
          </section>`;
      })
      .join('') || '<div class="empty-state">No hay personas asignadas en las pruebas publicadas.</div>';
  }

  function renderMine() {
    if (!state.data) return;
    const testsById = Object.fromEntries((state.data.tests || []).map(test => [String(test.id), test]));
    const requested = Array.from(state.selectedIds).map(id => testsById[id]).filter(Boolean);
    const assigned = (state.data.myAssignedTestIds || []).map(id => testsById[String(id)]).filter(Boolean);

    els.mineRequested.innerHTML = requested.length
      ? requested.map(test => `<span class="mine-tag requested">${VP.escapeHtml(test.name)}</span>`).join('')
      : '<p class="muted-copy">No has solicitado ninguna prueba.</p>';

    els.mineAssigned.innerHTML = assigned.length
      ? assigned
          .sort((a, b) => DAY_ORDER.indexOf(normalizedDay(a.day)) - DAY_ORDER.indexOf(normalizedDay(b.day)) || String(a.name).localeCompare(String(b.name), 'es'))
          .map(test => `<span class="mine-tag assigned"><small>${VP.escapeHtml(dayLabel(test.day))}</small>${VP.escapeHtml(test.name)}</span>`).join('')
      : '<p class="muted-copy">Todavía no tienes pruebas asignadas.</p>';
  }

  function updateTabAvailability() {
    const config = state.data.config || {};
    const requestsButton = document.querySelector('[data-tab="requests"]');
    const resolutionButton = document.querySelector('[data-tab="resolution"]');
    requestsButton.classList.toggle('nav-disabled', config.showRequests === false);
    resolutionButton.classList.toggle('nav-attention', config.showResolution === true);
  }

  function switchTab(tab) {
    if (!state.data && tab !== 'tests') return;
    state.activeTab = tab;
    document.querySelectorAll('[data-panel]').forEach(panel => {
      const active = panel.dataset.panel === tab;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    document.querySelectorAll('[data-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tab);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function changeInitialPin(event) {
    event.preventDefault();
    hideError(els.initialPinError);

    if (!isValidPin(els.initialPin.value)) {
      showError(els.initialPinError, 'El PIN debe tener exactamente 4 cifras.');
      return;
    }
    if (els.initialPin.value !== els.initialPinRepeat.value) {
      showError(els.initialPinError, 'Los dos PIN no coinciden.');
      return;
    }

    VP.setButtonBusy(els.initialPinButton, true, 'Guardando…');
    try {
      const result = await VP.api('changeInitialPin', {
        newPin: els.initialPin.value
      }, { token: state.session.token });

      state.session.user = result.user || Object.assign({}, state.session.user, { mustChangePin: false });
      state.session.user.mustChangePin = false;
      VP.saveSession(state.session);
      els.initialPinDialog.close();
      els.initialPinForm.reset();
      await loadData({ flushFirst: false });
    } catch (error) {
      showError(els.initialPinError, readableError(error));
    } finally {
      VP.setButtonBusy(els.initialPinButton, false);
    }
  }

  async function changePin(event) {
    event.preventDefault();
    hideError(els.passwordError);

    if (!isValidPin(els.currentPassword.value) || !isValidPin(els.newPassword.value)) {
      showError(els.passwordError, 'Los PIN deben tener exactamente 4 cifras.');
      return;
    }
    if (els.newPassword.value !== els.repeatPassword.value) {
      showError(els.passwordError, 'Los nuevos PIN no coinciden.');
      return;
    }

    const submit = els.passwordForm.querySelector('[type="submit"]');
    VP.setButtonBusy(submit, true, 'Cambiando…');
    try {
      await VP.api('changeMyPin', {
        currentPin: els.currentPassword.value,
        newPin: els.newPassword.value
      }, { token: state.session.token });
      els.passwordDialog.close();
      VP.clearSession();
      state.session = null;
      stopPolling();
      VP.showToast(els.toast, 'PIN cambiado. Inicia sesión de nuevo.');
      window.setTimeout(showLogin, 500);
    } catch (error) {
      showError(els.passwordError, readableError(error));
    } finally {
      VP.setButtonBusy(submit, false);
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
        await loadData({ quiet: true });
      }
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') endSession();
      if (error.code === 'PIN_CHANGE_REQUIRED') markPinChangeRequired();
    } finally {
      state.pollBusy = false;
    }
  }

  async function logout() {
    const token = state.session && state.session.token;
    endSession();
    if (token && navigator.onLine) {
      try { await VP.api('logout', {}, { token }); } catch (_) {}
    }
  }

  function endSession() {
    VP.clearSession();
    state.session = null;
    state.data = null;
    state.lastVersion = null;
    state.selectedIds.clear();
    stopPolling();
    showLogin();
  }

  async function handleOnline() {
    if (!state.session) return;
    try {
      const result = await VP.flushMyRequests(state.session.token);
      if (result.flushed && !result.empty) await loadData({ flushFirst: false });
      else await checkVersionNow();
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') endSession();
      if (error.code === 'PIN_CHANGE_REQUIRED') markPinChangeRequired();
    }
  }

  function markPinChangeRequired() {
    if (!state.session) return;
    state.session.user ||= {};
    state.session.user.mustChangePin = true;
    VP.saveSession(state.session);
    openInitialPinDialog();
  }

  function openInitialPinDialog() {
    showApp();
    els.initialPinForm.reset();
    hideError(els.initialPinError);
    if (!els.initialPinDialog.open) els.initialPinDialog.showModal();
    window.setTimeout(() => els.initialPin.focus(), 50);
  }

  function capacityStatus(count, places) {
    if (!Number.isFinite(places) || places <= 0) {
      return { key: 'neutral', label: 'Sin cupo definido' };
    }
    if (count < places) {
      const missing = places - count;
      return { key: 'shortage', label: `Faltan ${missing}` };
    }
    if (count > places) {
      const extra = count - places;
      return { key: 'surplus', label: `Sobran ${extra}` };
    }
    return { key: 'complete', label: 'Cupo completo' };
  }

  function requesterPreview(people) {
    if (!people.length) return 'Nadie más la ha solicitado';
    const visible = people.slice(0, 4).map(person => person.name);
    const extra = people.length - visible.length;
    return `También: ${visible.join(', ')}${extra > 0 ? ` y ${extra} más` : ''}`;
  }

  function normalizedDay(day) {
    return day && DAY_ORDER.includes(day) ? day : 'Sin día asignado';
  }

  function dayLabel(day) {
    return normalizedDay(day);
  }

  function groupTestsByDay(tests) {
    return (tests || []).reduce((groups, test) => {
      const day = normalizedDay(test.day);
      (groups[day] ||= []).push(test);
      return groups;
    }, {});
  }

  function isValidPin(value) {
    return /^\d{4}$/.test(String(value || ''));
  }

  function showLogin() {
    els.appView.hidden = true;
    els.loginView.hidden = false;
    hideError(els.loginError);
    window.setTimeout(() => els.loginUsername.focus(), 50);
  }

  function showApp() {
    els.loginView.hidden = true;
    els.appView.hidden = false;
  }

  function showError(element, message) {
    element.textContent = message;
    element.hidden = false;
  }

  function hideError(element) {
    element.hidden = true;
    element.textContent = '';
  }

  function readableError(error) {
    const map = {
      INVALID_CREDENTIALS: 'Usuario o PIN incorrectos.',
      NETWORK_ERROR: 'No se ha podido conectar. Comprueba la conexión e inténtalo de nuevo.',
      TIMEOUT: 'La conexión está tardando demasiado. Inténtalo otra vez.',
      INVALID_PASSWORD: 'El PIN actual no es correcto.',
      PIN_CHANGE_REQUIRED: 'Debes cambiar el PIN temporal antes de continuar.',
      VALIDATION_ERROR: error.message
    };
    return map[error.code] || error.message || 'No se ha podido completar la operación.';
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
})();