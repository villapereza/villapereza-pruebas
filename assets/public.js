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
    loadBusy: false,
    selectionDirty: false,
    syncBusy: false,
    syncAgain: false,
    selectionRevision: 0,
    confirmedSelection: null
  };

  const els = {};
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheElements();
    VP.bindCommonControls();
    bindEvents();
    registerServiceWorker();

    state.session = VP.getSession();
    if (state.session) await VP.migrateLegacyRequests(state.session.user && state.session.user.id);
    else await VP.discardLegacyRequests();
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
      button.addEventListener('click', async () => {
        switchTab(button.dataset.tab);
        await refreshEverything();
      });
    });

    document.querySelectorAll('[data-resolution-view]').forEach(button => {
      button.addEventListener('click', async () => {
        state.resolutionView = button.dataset.resolutionView;
        document.querySelectorAll('[data-resolution-view]').forEach(item => {
          item.classList.toggle('active', item.dataset.resolutionView === state.resolutionView);
        });
        renderResolution();
        await refreshEverything();
      });
    });

    els.profileButton.addEventListener('click', async () => {
      switchTab('mine');
      await refreshEverything();
    });
    els.logoutButton.addEventListener('click', logout);
    els.changePasswordButton.addEventListener('click', () => {
      els.passwordForm.reset();
      hideError(els.passwordError);
      els.passwordDialog.showModal();
    });
    els.passwordForm.addEventListener('submit', changePin);
    els.initialPinForm.addEventListener('submit', changeInitialPin);
    els.initialPinDialog.addEventListener('cancel', event => event.preventDefault());

    [els.loginPassword, els.currentPassword, els.newPassword, els.repeatPassword, els.initialPin, els.initialPinRepeat]
      .filter(Boolean)
      .forEach(bindPinInput);

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.session) refreshEverything();
    });

    document.addEventListener('click', event => {
      if (event.target.closest('button, a, [role="button"]')) queueVersionCheck(80);
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    hideError(els.loginError);
    if (!isValidPin(els.loginPassword.value)) {
      showError(els.loginError, 'El PIN debe contener al menos una cifra y solo puede incluir números.');
      return;
    }
    VP.setButtonBusy(els.loginButton, true, 'Entrando…');

    try {
      const result = await VP.api('login', {
        username: els.loginUsername.value,
        password: els.loginPassword.value
      });
      state.session = result;
      VP.saveSession(result);
      await VP.discardLegacyRequests();
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
    const revisionAtStart = state.selectionRevision;
    let data = null;

    try {
      if (options.flushFirst !== false) {
        try {
          const flushed = await VP.flushMyRequests(state.session.token, currentUserId());
          applyFlushResult(flushed);
        } catch (error) {
          if (error.code === 'UNAUTHORIZED' || error.code === 'PIN_CHANGE_REQUIRED') throw error;
        }
      }

      data = await VP.api('getPublicData', {}, { token: state.session.token });
      VP.savePublicCache(data);
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        state.loadBusy = false;
        endSession();
        return;
      }
      if (error.code === 'PIN_CHANGE_REQUIRED') {
        state.loadBusy = false;
        markPinChangeRequired();
        return;
      }

      data = VP.getPublicCache();
      if (!data) {
        if (!options.quiet) VP.showToast(els.toast, 'No se han podido cargar los datos. Comprueba la conexión.');
        state.loadBusy = false;
        return;
      }
    }

    const userId = currentUserId(data);
    const queued = await VP.getQueuedRequests(userId);
    const localSelection = VP.getLocalSelection(userId);
    const serverIds = (data.myRequestTestIds || []).map(String);
    const selectionChangedDuringLoad = state.selectionRevision !== revisionAtStart;
    const mustPreserveOptimistic = state.selectionDirty || state.syncBusy || selectionChangedDuringLoad;
    const confirmedStillFresh = state.confirmedSelection && state.confirmedSelection.expiresAt > Date.now();

    state.data = data;
    state.lastVersion = String(data.dataVersion || state.lastVersion || '');

    if (mustPreserveOptimistic) {
      // Una lectura iniciada antes del toque del usuario nunca puede deshacer su selección.
    } else if (localSelection) {
      state.selectedIds = new Set(localSelection.ids);
      state.selectionRevision = Math.max(state.selectionRevision, Number(localSelection.revision) || 0);
      state.selectionDirty = true;
    } else if (confirmedStillFresh && !sameIds(serverIds, state.confirmedSelection.ids)) {
      state.selectedIds = new Set(state.confirmedSelection.ids);
    } else {
      state.selectedIds = new Set(serverIds);
      state.confirmedSelection = null;
      state.selectionDirty = false;
    }

    renderAll();
    state.loadBusy = false;
    if (localSelection && state.selectionDirty && !state.syncBusy && navigator.onLine) {
      window.setTimeout(() => syncSelectionAndReload({ alwaysReload: false }), 800);
    }
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
    state.selectionRevision += 1;
    state.selectionDirty = true;
    state.confirmedSelection = null;

    updateSelectedCount();
    persistSelection();
    renderTests();
    renderMine();
  }

  function updateSelectedCount() {
    els.selectedCount.textContent = String(state.selectedIds.size);
  }

  function persistSelection() {
    const ids = Array.from(state.selectedIds);
    VP.saveLocalSelection(currentUserId(), ids, state.selectionRevision);
    window.clearTimeout(state.savingTimer);
    state.savingTimer = window.setTimeout(() => syncSelectionAndReload(), 220);
  }

  async function refreshEverything() {
    if (!state.session || (state.session.user && state.session.user.mustChangePin)) return;
    window.clearTimeout(state.savingTimer);

    if (state.selectionDirty || state.syncBusy) {
      await syncSelectionAndReload({ alwaysReload: true });
      return;
    }

    await forceLoadData();
  }

  async function syncSelectionAndReload(options = {}) {
    if (!state.session || (state.session.user && state.session.user.mustChangePin)) return;
    window.clearTimeout(state.savingTimer);

    if (state.syncBusy) {
      state.syncAgain = true;
      return;
    }

    state.syncBusy = true;
    const userId = currentUserId();
    const snapshotRevision = state.selectionRevision;
    const snapshotIds = Array.from(state.selectedIds);

    try {
      await VP.queueMyRequests(userId, snapshotIds, snapshotRevision);
      const flushed = navigator.onLine
        ? await VP.flushMyRequests(state.session.token, userId)
        : { flushed: false };

      if (flushed.flushed && !flushed.empty) {
        const confirmedIds = flushed.data && Array.isArray(flushed.data.selectedTestIds)
          ? flushed.data.selectedTestIds.map(String)
          : snapshotIds;

        if (state.selectionRevision === snapshotRevision) {
          state.selectedIds = new Set(confirmedIds);
          state.selectionDirty = false;
          state.confirmedSelection = {
            ids: confirmedIds,
            expiresAt: Date.now() + 12000
          };
          if (flushed.data && flushed.data.dataVersion) {
            state.lastVersion = String(flushed.data.dataVersion);
          }
        }
      }

      if (options.alwaysReload !== false && navigator.onLine) {
        await forceLoadData();
      }
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') endSession();
      if (error.code === 'PIN_CHANGE_REQUIRED') markPinChangeRequired();
      if (['REQUESTS_CLOSED', 'TEST_CLOSED'].includes(error.code)) {
        state.selectionDirty = false;
        state.confirmedSelection = null;
        VP.showToast(els.toast, error.message);
        await forceLoadData();
      }
    } finally {
      state.syncBusy = false;
      const hasNewerSelection = state.selectionRevision !== snapshotRevision;
      if (state.syncAgain || hasNewerSelection) {
        state.syncAgain = false;
        window.setTimeout(() => syncSelectionAndReload({ alwaysReload: true }), 0);
      } else if (state.selectionDirty && navigator.onLine) {
        window.setTimeout(() => syncSelectionAndReload({ alwaysReload: true }), 1500);
      }
    }
  }

  function applyFlushResult(result) {
    if (!result || !result.flushed || result.empty || !result.data) return;
    const ids = Array.isArray(result.data.selectedTestIds) ? result.data.selectedTestIds.map(String) : null;
    if (ids && (!result.record || Number(result.record.revision) >= state.selectionRevision)) {
      state.selectedIds = new Set(ids);
      state.selectionRevision = Math.max(state.selectionRevision, Number(result.record && result.record.revision) || 0);
      state.selectionDirty = false;
      state.confirmedSelection = { ids, expiresAt: Date.now() + 12000 };
    }
    if (result.data.dataVersion) state.lastVersion = String(result.data.dataVersion);
  }

  async function forceLoadData() {
    let attempts = 0;
    while (state.loadBusy && attempts < 200) {
      await new Promise(resolve => window.setTimeout(resolve, 25));
      attempts += 1;
    }
    await loadData({ flushFirst: false, quiet: true });
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
      showError(els.initialPinError, 'El PIN debe contener al menos una cifra y solo puede incluir números.');
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
      showError(els.passwordError, 'Los PIN deben contener al menos una cifra y solo pueden incluir números.');
      return;
    }
    if (els.newPassword.value !== els.repeatPassword.value) {
      showError(els.passwordError, 'Los nuevos PIN no coinciden.');
      return;
    }

    const submit = els.passwordForm.querySelector('[type="submit"]');
    VP.setButtonBusy(submit, true, 'Cambiando…');
    try {
      await VP.api('changeMyPassword', {
        currentPassword: els.currentPassword.value,
        currentPin: els.currentPassword.value,
        newPassword: els.newPassword.value,
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
    if (!state.session || state.pollBusy || state.syncBusy || !navigator.onLine || (state.session.user && state.session.user.mustChangePin)) return;
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
    state.selectionDirty = false;
    state.syncBusy = false;
    state.syncAgain = false;
    state.selectionRevision = 0;
    state.confirmedSelection = null;
    stopPolling();
    showLogin();
  }

  async function handleOnline() {
    if (!state.session) return;
    try {
      const result = await VP.flushMyRequests(state.session.token, currentUserId());
      applyFlushResult(result);
      await refreshEverything();
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

  function currentUserId(data = state.data) {
    return String((data && data.currentUser && data.currentUser.id) || (state.session && state.session.user && state.session.user.id) || '');
  }

  function sameIds(a, b) {
    const left = Array.from(new Set((a || []).map(String))).sort();
    const right = Array.from(new Set((b || []).map(String))).sort();
    return left.length === right.length && left.every((value, index) => value === right[index]);
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
    return /^\d+$/.test(String(value || ''));
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

  function bindPinInput(input) {
    input.addEventListener('input', () => {
      const clean = String(input.value || '').replace(/\D/g, '');
      if (input.value !== clean) input.value = clean;
    });
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
      NOT_FOUND: 'El servidor no tiene todavía esta opción. Actualiza e implementa el backend v6.3.',
      VALIDATION_ERROR: error.message
    };
    return map[error.code] || error.message || 'No se ha podido completar la operación.';
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(registration => registration.update()).catch(() => {});
    }
  }
})();