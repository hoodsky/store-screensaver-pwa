// Shared Cloudflare R2 library. Kiosks can read anonymously; only uploads need
// the administrator password configured as a Worker secret.
import { CLOUD_CONFIG } from './cloud-config.js';
import * as DB from './db.js';
import * as Screensaver from './screensaver.js';

const CACHE_KEY = 'synced';
const META_KEY = 'sharedVideoMeta';
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
let active = false;
let refreshPromise = null;

export function isConfigured() {
  return Boolean(CLOUD_CONFIG.apiBaseUrl && !CLOUD_CONFIG.apiBaseUrl.startsWith('PASTE_'));
}

function endpoint(path) {
  if (!isConfigured()) throw new Error('Спершу налаштуйте URL у js/cloud-config.js');
  return new URL(path, CLOUD_CONFIG.apiBaseUrl.endsWith('/') ? CLOUD_CONFIG.apiBaseUrl : `${CLOUD_CONFIG.apiBaseUrl}/`);
}

async function request(path, options = {}) {
  const response = await fetch(endpoint(path), options);
  if (!response.ok) {
    let message = '';
    try { message = (await response.json()).error || ''; } catch {}
    throw new Error(message || `Cloud sync HTTP ${response.status}`);
  }
  return response;
}

export async function getCachedMeta() {
  return DB.getSetting(META_KEY, null);
}

export async function refreshSharedVideo() {
  if (!isConfigured()) throw new Error('Спершу налаштуйте Cloudflare у CLOUDFLARE_SETUP.md');
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const remote = await (await request('manifest')).json();
    const [cachedMeta, cachedBlob] = await Promise.all([
      getCachedMeta(),
      DB.getVideoBlob(CACHE_KEY),
    ]);
    if (cachedBlob && cachedMeta?.etag === remote.etag) {
      return { updated: false, fileName: cachedMeta.fileName || remote.fileName || 'video' };
    }

    const blob = await (await request('video')).blob();
    if (!blob.size) throw new Error('Сховище повернуло порожнє відео');
    await DB.saveVideoBlob(blob, CACHE_KEY);
    await DB.saveSetting(META_KEY, {
      etag: remote.etag,
      fileName: remote.fileName || 'video',
      size: blob.size,
      modifiedAt: remote.modifiedAt || '',
    });
    try { await navigator.storage?.persist?.(); } catch {}
    if (active) await Screensaver.loadVideo(blob);
    return { updated: true, fileName: remote.fileName || 'video' };
  })();

  try { return await refreshPromise; }
  finally { refreshPromise = null; }
}

export async function uploadLocalVideo(file, password) {
  const extensionType = ({ mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' })[
    file.name.split('.').pop()?.toLowerCase()
  ];
  const contentType = file.type.startsWith('video/') ? file.type : extensionType;
  if (!contentType) throw new Error('Оберіть відеофайл');
  if (!password) throw new Error('Введіть пароль адміністратора синхронізації');
  const auth = { Authorization: `Bearer ${password}` };
  const upload = await (await request('upload-url', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, contentType, size: file.size }),
  })).json();

  const uploaded = await fetch(upload.url, {
    method: 'PUT', headers: { 'Content-Type': contentType }, body: file,
  });
  if (!uploaded.ok) throw new Error(`Завантаження у сховище: HTTP ${uploaded.status}`);

  await request('complete', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name }),
  });
  active = true;
  return refreshSharedVideo();
}

export async function importDriveLink(link, password) {
  if (!password) throw new Error('Введіть пароль адміністратора синхронізації');
  await request('import-drive', {
    method: 'POST',
    headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ link }),
  });
  active = true;
  return refreshSharedVideo();
}

export async function activate() {
  active = true;
  await Screensaver.loadStoredVideo(() => DB.getVideoBlob(CACHE_KEY));
  if (navigator.onLine) {
    refreshSharedVideo().catch((error) => console.warn('Не вдалося оновити спільне відео:', error));
  }
}

export function stop() {
  active = false;
}

export function startUpdateChecks() {
  const updateIfActive = () => {
    if (active && navigator.onLine) {
      refreshSharedVideo().catch((error) => console.warn('Не вдалося перевірити спільне відео:', error));
    }
  };
  window.addEventListener('online', updateIfActive);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') updateIfActive();
  });
  window.setInterval(updateIfActive, CHECK_INTERVAL_MS);
}
