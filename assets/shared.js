(() => {
  'use strict';

  const config = window.VP_CONFIG || {};
  const DB_NAME = 'villa-pereza-pruebas';
  const DB_VERSION = 1;
  const SESSION_KEY = 'vp_session_v8';
  const LEGACY_SESSION_KEYS = ['vp_session_v1'];
  const PUBLIC_CACHE_KEY = 'vp_public_cache_v8';
  const LEGACY_SELECTION_KEY = 'vp_local_selection_v1';
  const USER_SELECTION_PREFIX = 'vp_local_selection_v2:';

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


  async function clearObsoleteBrowserCaches() {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(name => caches.delete(name)));
      }
    } catch (_) {}
  }

  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function getSession() {
    try {
      let raw = localStorage.getItem(SESSION_KEY);
      if (!raw) {
        for (const legacyKey of LEGACY_SESSION_KEYS) {
          raw = localStorage.getItem(legacyKey);
          if (raw) {
            localStorage.setItem(SESSION_KEY, raw);
            localStorage.removeItem(legacyKey);
            break;
          }
        }
      }
      const session = JSON.parse(raw || 'null');
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
    LEGACY_SESSION_KEYS.forEach(key => localStorage.removeItem(key));
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

  function normalizeUserId(userId) {
    return String(userId || '').trim();
  }

  function selectionKey(userId) {
    return USER_SELECTION_PREFIX + encodeURIComponent(normalizeUserId(userId));
  }

  function saveLocalSelection(userId, ids, revision) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return null;
    const record = {
      userId: normalizedUserId,
      ids: Array.from(new Set((ids || []).map(String))),
      revision: Number.isFinite(Number(revision)) ? Number(revision) : Date.now(),
      savedAt: Date.now()
    };
    localStorage.setItem(selectionKey(normalizedUserId), JSON.stringify(record));
    return record;
  }

  function getLocalSelection(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(selectionKey(normalizedUserId)) || 'null');
      if (!parsed || !Array.isArray(parsed.ids)) return null;
      return {
        userId: normalizedUserId,
        ids: parsed.ids.map(String),
        revision: Number(parsed.revision) || 0,
        savedAt: Number(parsed.savedAt) || 0
      };
    } catch (_) {
      return null;
    }
  }

  function clearLocalSelection(userId, expectedRevision) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return false;
    const current = getLocalSelection(normalizedUserId);
    if (expectedRevision !== undefined && current && Number(current.revision) !== Number(expectedRevision)) {
      return false;
    }
    localStorage.removeItem(selectionKey(normalizedUserId));
    return true;
  }

  function clearLegacyLocalSelection() {
    localStorage.removeItem(LEGACY_SELECTION_KEY);
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

  async function putOutboxRecord(record) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        tx.objectStore('outbox').put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Operación cancelada'));
      });
    } finally {
      db.close();
    }
  }

  async function getOutboxRecord(id) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readonly');
        const request = tx.objectStore('outbox').get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  async function deleteOutboxRecordIfMatches(id, operationId) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        const store = tx.objectStore('outbox');
        let removed = false;
        const request = store.get(id);
        request.onsuccess = () => {
          const current = request.result;
          if (current && (!operationId || current.operationId === operationId)) {
            store.delete(id);
            removed = true;
          }
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve(removed);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Operación cancelada'));
      });
    } finally {
      db.close();
    }
  }

  function outboxId(userId) {
    return `set-my-requests:${normalizeUserId(userId)}`;
  }

  async function queueMyRequests(userId, testIds, revision) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) throw new VPError('NO_USER', 'No se ha identificado al usuario.');
    const record = {
      id: outboxId(normalizedUserId),
      action: 'setMyRequests',
      operationId: createOperationId(),
      userId: normalizedUserId,
      revision: Number.isFinite(Number(revision)) ? Number(revision) : Date.now(),
      testIds: Array.from(new Set((testIds || []).map(String))),
      queuedAt: new Date().toISOString()
    };
    await putOutboxRecord(record);
    return record;
  }

  async function getQueuedRequests(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return null;
    try {
      return await getOutboxRecord(outboxId(normalizedUserId));
    } catch (_) {
      return null;
    }
  }

  async function removeQueuedRequests(userId, operationId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return false;
    try {
      return await deleteOutboxRecordIfMatches(outboxId(normalizedUserId), operationId);
    } catch (_) {
      return false;
    }
  }

  async function migrateLegacyRequests(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
      await discardLegacyRequests();
      return null;
    }

    let legacySelection = [];
    const legacySelectionPresent = localStorage.getItem(LEGACY_SELECTION_KEY) !== null;
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_SELECTION_KEY) || '[]');
      if (Array.isArray(parsed)) legacySelection = parsed.map(String);
    } catch (_) {}

    try {
      const legacyRecord = await getOutboxRecord('set-my-requests');
      if (legacyRecord) {
        const revision = Date.now();
        const ids = Array.isArray(legacyRecord.testIds) ? legacyRecord.testIds.map(String) : legacySelection;
        const migrated = {
          id: outboxId(normalizedUserId),
          action: 'setMyRequests',
          operationId: legacyRecord.operationId || createOperationId(),
          userId: normalizedUserId,
          revision,
          testIds: Array.from(new Set(ids)),
          queuedAt: legacyRecord.queuedAt || new Date().toISOString()
        };
        await putOutboxRecord(migrated);
        saveLocalSelection(normalizedUserId, migrated.testIds, revision);
      } else if (legacySelectionPresent) {
        saveLocalSelection(normalizedUserId, legacySelection, Date.now());
      }
      await deleteOutboxRecordIfMatches('set-my-requests');
    } catch (_) {}

    clearLegacyLocalSelection();
    return getQueuedRequests(normalizedUserId);
  }

  async function discardLegacyRequests() {
    clearLegacyLocalSelection();
    try {
      await deleteOutboxRecordIfMatches('set-my-requests');
    } catch (_) {}
  }

  async function flushMyRequests(token, userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!token || !normalizedUserId || !navigator.onLine) return { flushed: false };
    const record = await getQueuedRequests(normalizedUserId);
    if (!record) return { flushed: true, empty: true };

    try {
      const data = await api('setMyRequests', {
        operationId: record.operationId,
        testIds: record.testIds
      }, { token });
      const removed = await removeQueuedRequests(normalizedUserId, record.operationId);
      if (removed) clearLocalSelection(normalizedUserId, record.revision);
      return { flushed: true, data, record, removed };
    } catch (error) {
      if (['REQUESTS_CLOSED', 'TEST_CLOSED'].includes(error.code)) {
        const removed = await removeQueuedRequests(normalizedUserId, record.operationId);
        if (removed) clearLocalSelection(normalizedUserId, record.revision);
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
    clearLegacyLocalSelection,
    queueMyRequests,
    getQueuedRequests,
    removeQueuedRequests,
    migrateLegacyRequests,
    discardLegacyRequests,
    flushMyRequests,
    createOperationId,
    initials,
    escapeHtml,
    toBoolean,
    showToast,
    setButtonBusy,
    bindCommonControls,
    clearObsoleteBrowserCaches
  });
})();
