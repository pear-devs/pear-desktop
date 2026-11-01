export const CLOUD_STORAGE_KEY = 'dailyReplayCloudState';

export const DEFAULT_CLOUD_STATE = {
  serverBaseUrl: 'https://lrchub.coreone.work',
  loginPath: '/auth/discord',
  recoveryToken: null,
  lastSyncAt: null,
  lastSyncInfo: null,
};

export function loadCloudState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(CLOUD_STORAGE_KEY, (items) => {
      const stored = items && items[CLOUD_STORAGE_KEY] ? items[CLOUD_STORAGE_KEY] : {};
      resolve(Object.assign({}, DEFAULT_CLOUD_STATE, stored));
    });
  });
}

export async function saveCloudState(patchOrNew) {
  const current = await loadCloudState();
  const merged =
    typeof patchOrNew === 'function'
      ? patchOrNew(current)
      : Object.assign({}, current, patchOrNew || {});
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CLOUD_STORAGE_KEY]: merged }, () => resolve(merged));
  });
}

export async function cloudSyncHistory(history) {
  const state = await loadCloudState();
  if (!state.recoveryToken) {
    return { ok: false, error: 'NO_TOKEN' };
  }

  const base = (state.serverBaseUrl || DEFAULT_CLOUD_STATE.serverBaseUrl || '').replace(/\/+$/, '');
  const url = base + '/api/history';

  const payload = {
    code: state.recoveryToken,
    history: Array.isArray(history) ? history : [],
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: 'NETWORK_ERROR: ' + e };
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
  }

  if (!res.ok) {
    return {
      ok: false,
      error: 'HTTP_' + res.status + (data && data.error ? ':' + data.error : ''),
    };
  }

  const mergedHistory = data && Array.isArray(data.history) ? data.history : null;

  const now = Date.now();
  const info = {
    sentCount: payload.history.length,
    serverCount: mergedHistory ? mergedHistory.length : null,
  };

  await saveCloudState({
    lastSyncAt: now,
    lastSyncInfo: info,
  });

  return {
    ok: true,
    mergedHistory,
    lastSyncAt: now,
    lastSyncInfo: info,
  };
}
