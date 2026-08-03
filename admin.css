(() => {
  'use strict';

  const config = window.VP_CONFIG || {};
  const DB_NAME = 'villa-pereza-pruebas';
  const DB_VERSION = 1;
  const SESSION_KEY = 'vp_session_v1';
  const PUBLIC_CACHE_KEY = 'vp_public_cache_v1';
  const LOCAL_SELECTION_KEY = 'vp_local_selection_v1';

  class VPError extends Error {
    constructor(code, message, details) {
      super(message || 'Se ha producido un error.');
      this.name = 'VPError';
      this.code = code || 'UNKNOWN_ERROR';
      this.details = details;
    }
  }

  async function api(action, payload = {}, options = {}) {
    if (!config.API_URL) throw new VPError('CONFIG_ERROR', 'No se ha configurado la API.');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), config.REQUEST_TIMEOUT_MS || 25000);
    const body = Object.assign({ action }, payload);
    if (options.token) body.token = options.token;

    try {
      const response = await fetch(config.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'follow',
        cache: 'no-store'
      });
      const text = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        throw new VPError('INVALID_RESPONSE', 'La respuesta del servidor no es válida.');
      }
      if (!parsed || parsed.ok !== true) {
        const error = parsed && parsed.error ? parsed.error : {};
        throw new VPError(error.code || 'API_ERROR', error.message || 'No se ha podido completar la operación.', error);
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof VPError) throw error;
      if (error && error.name === 'AbortError') {
        throw new VPError('TIMEOUT', 'La conexión está tardando demasiado.');
      }
      throw new VPError('NETWORK_ERROR', 'No se ha podido conectar con el servidor.', error);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function getSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!session || !session.token || !session.user) return null;
      if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
        clearSession();
        return null;
      }
      return session;
    } catch (_) {
      clearSession();
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function savePublicCache(data) {
    try {
      localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_) {}
  }

  function getPublicCache() {
    try {
      const cache = JSON.parse(localStorage.getItem(PUBLIC_CACHE_KEY) || 'null');
      return cache && cache.data ? cache.data : null;
    } catch (_) {
      return null;
    }
  }

  function saveLocalSelection(ids) {
    const value = Array.from(new Set((ids || []).map(String)));
    localStorage.setItem(LOCAL_SELECTION_KEY, JSON.stringify(value));
  }

  function getLocalSelection() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_SELECTION_KEY) || '[]');
      return Array.isArray(value) ? value.map(String) : [];
    } catch (_) {
      return [];
    }
  }

  function clearLocalSelection() {
    localStorage.removeItem(LOCAL_SELECTION_KEY);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new VPError('NO_INDEXED_DB', 'El almacenamiento local no está disponible.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withStore(mode, handler) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('outbox', mode);
        const store = transaction.objectStore('outbox');
        let result;
        try {
          result = handler(store, transaction);
        } catch (error) {
          reject(error);
          return;
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Operación cancelada'));
      });
    } finally {
      db.close();
    }
  }

  async function queueMyRequests(testIds) {
    const record = {
      id: 'set-my-requests',
      action: 'setMyRequests',
      operationId: createOperationId(),
      testIds: Array.from(new Set((testIds || []).map(String))),
      queuedAt: new Date().toISOString()
    };
    await withStore('readwrite', store => store.put(record));
    return record;
  }

  async function getQueuedRequests() {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readonly');
        const request = tx.objectStore('outbox').get('set-my-requests');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      });
    } catch (_) {
      return null;
    }
  }

  async function removeQueuedRequests() {
    try {
      await withStore('readwrite', store => store.delete('set-my-requests'));
    } catch (_) {}
  }

  async function flushMyRequests(token) {
    if (!token || !navigator.onLine) return { flushed: false };
    const record = await getQueuedRequests();
    if (!record) return { flushed: true, empty: true };
    try {
      const data = await api('setMyRequests', {
        operationId: record.operationId,
        testIds: record.testIds
      }, { token });
      await removeQueuedRequests();
      clearLocalSelection();
      return { flushed: true, data };
    } catch (error) {
      if (['REQUESTS_CLOSED', 'TEST_CLOSED'].includes(error.code)) {
        await removeQueuedRequests();
        clearLocalSelection();
      }
      throw error;
    }
  }

  function createOperationId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `web-${window.crypto.randomUUID()}`;
    }
    const random = Math.random().toString(36).slice(2);
    return `web-${Date.now()}-${random}-${Math.random().toString(36).slice(2)}`;
  }

  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return 'VP';
    return words.slice(0, 2).map(word => word[0]).join('').toUpperCase();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toBoolean(value) {
    return value === true || String(value).toUpperCase() === 'TRUE' || String(value) === '1';
  }

  function showToast(element, message, duration = 3000) {
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
    window.clearTimeout(element._hideTimer);
    element._hideTimer = window.setTimeout(() => { element.hidden = true; }, duration);
  }

  function setButtonBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = busyLabel || 'Procesando…';
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.disabled = false;
    }
  }

  function bindCommonControls(root = document) {
    root.querySelectorAll('[data-toggle-password]').forEach(button => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.togglePassword);
        if (!input) return;
        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        button.textContent = visible ? 'Ver' : 'Ocultar';
      });
    });
    root.querySelectorAll('[data-close-dialog]').forEach(button => {
      button.addEventListener('click', () => {
        const dialog = document.getElementById(button.dataset.closeDialog);
        if (dialog && dialog.open) dialog.close();
      });
    });
  }

  window.VP = Object.freeze({
    api,
    VPError,
    saveSession,
    getSession,
    clearSession,
    savePublicCache,
    getPublicCache,
    saveLocalSelection,
    getLocalSelection,
    clearLocalSelection,
    queueMyRequests,
    getQueuedRequests,
    removeQueuedRequests,
    flushMyRequests,
    createOperationId,
    initials,
    escapeHtml,
    toBoolean,
    showToast,
    setButtonBusy,
    bindCommonControls
  });
})();
