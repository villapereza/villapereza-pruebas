(() => {
  'use strict';

  const state = {
    session: null,
    data: null,
    selectedIds: new Set(),
    savingTimer: null,
    activeTab: 'tests'
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
    await loadData();
  }

  function cacheElements() {
    [
      'loginView', 'appView', 'loginForm', 'loginUsername', 'loginPassword', 'loginButton', 'loginError',
      'publicTitle', 'profileInitial', 'testsList', 'testsEmpty', 'selectedCount', 'requestsClosedBanner',
      'requestersList', 'requestsHidden', 'resolutionList', 'resolutionHidden', 'mineAvatar', 'mineName',
      'mineUsername', 'mineRequested', 'mineAssigned', 'profileButton', 'logoutButton', 'changePasswordButton',
      'passwordDialog', 'passwordForm', 'currentPassword', 'newPassword', 'repeatPassword', 'passwordError', 'toast'
    ].forEach(id => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.loginForm.addEventListener('submit', handleLogin);
    document.querySelectorAll('[data-tab]').forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    });
    els.profileButton.addEventListener('click', () => switchTab('mine'));
    els.logoutButton.addEventListener('click', logout);
    els.changePasswordButton.addEventListener('click', () => {
      els.passwordForm.reset();
      hideError(els.passwordError);
      els.passwordDialog.showModal();
    });
    els.passwordForm.addEventListener('submit', changePassword);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.session) handleOnline();
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
      await loadData();
    } catch (error) {
      showError(els.loginError, readableError(error));
    } finally {
      VP.setButtonBusy(els.loginButton, false);
    }
  }

  async function loadData(options = {}) {
    if (!state.session) return;
    let data = null;
    try {
      if (options.flushFirst !== false) {
        try { await VP.flushMyRequests(state.session.token); } catch (error) {
          if (error.code === 'UNAUTHORIZED') throw error;
        }
      }
      data = await VP.api('getPublicData', {}, { token: state.session.token });
      VP.savePublicCache(data);
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        endSession();
        return;
      }
      data = VP.getPublicCache();
      if (!data) {
        VP.showToast(els.toast, 'No se han podido cargar los datos. Comprueba la conexión.');
        return;
      }
    }

    state.data = data;
    const queued = await VP.getQueuedRequests();
    const localSelection = VP.getLocalSelection();
    state.selectedIds = new Set(queued && localSelection.length ? localSelection : (data.myRequestTestIds || []).map(String));
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
    const data = state.data;
    const tests = data.tests || [];
    const globallyOpen = data.config && data.config.requestsGloballyOpen !== false;
    els.requestsClosedBanner.hidden = globallyOpen;
    els.testsEmpty.hidden = tests.length > 0;

    els.testsList.innerHTML = tests.map((test, index) => {
      const selected = state.selectedIds.has(String(test.id));
      const enabled = globallyOpen && test.requestsOpen;
      const applicants = Array.isArray(test.requesters) ? test.requesters.length : 0;
      const placesText = Number(test.places) > 0 ? `${test.places} ${Number(test.places) === 1 ? 'plaza' : 'plazas'}` : 'Sin límite indicado';
      return `
        <article class="test-card ${selected ? 'selected' : ''} ${enabled ? '' : 'locked'}" style="--card-index:${index}">
          <label class="test-selector">
            <input class="test-checkbox" type="checkbox" data-test-id="${VP.escapeHtml(test.id)}" ${selected ? 'checked' : ''} ${enabled ? '' : 'disabled'}>
            <span class="custom-check" aria-hidden="true">✓</span>
            <span class="test-main">
              <span class="test-title-row"><strong>${VP.escapeHtml(test.name)}</strong><span class="place-pill">${VP.escapeHtml(placesText)}</span></span>
              ${test.description ? `<span class="test-description">${VP.escapeHtml(test.description)}</span>` : ''}
              <span class="test-meta">${applicants} ${applicants === 1 ? 'persona interesada' : 'personas interesadas'}${enabled ? '' : ' · Cerrada'}</span>
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
    event.currentTarget.closest('.test-card').classList.toggle('selected', event.currentTarget.checked);
    updateSelectedCount();
    persistSelection();
    renderMine();
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
          const cache = VP.getPublicCache();
          if (cache) {
            cache.myRequestTestIds = ids;
            VP.savePublicCache(cache);
          }
        }
      } catch (error) {
        if (error.code === 'UNAUTHORIZED') endSession();
        if (['REQUESTS_CLOSED', 'TEST_CLOSED'].includes(error.code)) {
          VP.showToast(els.toast, error.message);
          await loadData({ flushFirst: false });
        }
      }
    }, 450);
  }

  function renderRequests() {
    const visible = state.data.config && state.data.config.showRequests !== false;
    els.requestsHidden.hidden = visible;
    els.requestersList.hidden = !visible;
    if (!visible) return;

    els.requestersList.innerHTML = (state.data.tests || []).map(test => {
      const people = test.requesters || [];
      return `
        <article class="people-card">
          <div class="people-card-heading">
            <div><span class="small-label">PRUEBA</span><h3>${VP.escapeHtml(test.name)}</h3></div>
            <span class="count-badge">${people.length}</span>
          </div>
          <div class="people-list">
            ${people.length ? people.map(person => `<span class="person-chip"><b>${VP.escapeHtml(VP.initials(person.name))}</b>${VP.escapeHtml(person.name)}</span>`).join('') : '<p class="muted-copy">Todavía no la ha solicitado nadie.</p>'}
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

    els.resolutionList.innerHTML = publishedTests.map((test, index) => {
      const people = test.assigned || [];
      return `
        <article class="resolution-card" style="--card-index:${index}">
          <div class="resolution-star">★</div>
          <span class="small-label">EQUIPO DEFINITIVO</span>
          <h3>${VP.escapeHtml(test.name)}</h3>
          <div class="resolved-people">
            ${people.length ? people.map(person => `<span><b>${VP.escapeHtml(VP.initials(person.name))}</b>${VP.escapeHtml(person.name)}</span>`).join('') : '<p class="muted-copy">No hay participantes asignadas.</p>'}
          </div>
        </article>`;
    }).join('');
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
      ? assigned.map(test => `<span class="mine-tag assigned">${VP.escapeHtml(test.name)}</span>`).join('')
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
    document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function changePassword(event) {
    event.preventDefault();
    hideError(els.passwordError);
    if (els.newPassword.value !== els.repeatPassword.value) {
      showError(els.passwordError, 'Las nuevas contraseñas no coinciden.');
      return;
    }
    const submit = els.passwordForm.querySelector('[type="submit"]');
    VP.setButtonBusy(submit, true, 'Cambiando…');
    try {
      await VP.api('changeMyPassword', {
        currentPassword: els.currentPassword.value,
        newPassword: els.newPassword.value
      }, { token: state.session.token });
      els.passwordDialog.close();
      VP.clearSession();
      state.session = null;
      VP.showToast(els.toast, 'Contraseña cambiada. Inicia sesión de nuevo.');
      window.setTimeout(showLogin, 700);
    } catch (error) {
      showError(els.passwordError, readableError(error));
    } finally {
      VP.setButtonBusy(submit, false);
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
    state.selectedIds.clear();
    showLogin();
  }

  async function handleOnline() {
    if (!state.session) return;
    try {
      const result = await VP.flushMyRequests(state.session.token);
      if (result.flushed && !result.empty) await loadData({ flushFirst: false });
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') endSession();
    }
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
      INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.',
      NETWORK_ERROR: 'No se ha podido conectar. Comprueba la conexión e inténtalo de nuevo.',
      TIMEOUT: 'La conexión está tardando demasiado. Inténtalo otra vez.',
      INVALID_PASSWORD: 'La contraseña actual no es correcta.',
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
