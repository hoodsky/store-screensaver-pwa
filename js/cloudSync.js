// Public video files live in Google Drive; Cloudflare Workers KV stores only
// the current file pointer. Devices need no Google login; only an administrator
// uploads videos, which are shared as "Anyone with the link".
import { CLOUD_CONFIG } from './cloud-config.js';
import { GOOGLE_DRIVE_CONFIG } from './google-drive-config.js';
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

async function getGoogleAccessToken() {
  if (!GOOGLE_DRIVE_CONFIG.clientId || GOOGLE_DRIVE_CONFIG.clientId.startsWith('PASTE_')) {
    throw new Error('Одноразово налаштуйте Google OAuth Client ID у js/google-drive-config.js');
  }
  if (!window.google?.accounts?.oauth2) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Не вдалося завантажити Google Identity Services'));
      document.head.append(script);
    });
  }
  if (!window.google?.accounts?.oauth2) throw new Error('Google Identity Services недоступний');
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_DRIVE_CONFIG.clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (result) => result?.access_token
        ? resolve(result.access_token)
        : reject(new Error(result?.error_description || result?.error || 'Google не видав токен доступу')),
      error_callback: (error) => reject(new Error(error?.message || 'Не вдалося увійти в Google')),
    });
    client.requestAccessToken();
  });
}

async function uploadFileToDrive(file, accessToken) {
  const mimeType = file.type.startsWith('video/') ? file.type : 'video/mp4';
  const existing = await request('manifest').then((response) => response.json()).catch(() => null);
  const fileId = existing?.managedByApp ? existing.fileId : null;
  const endpointUrl = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=id,name,mimeType,size,modifiedTime,md5Checksum`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,modifiedTime,md5Checksum';
  const init = await fetch(endpointUrl, {
    method: fileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({ name: file.name, mimeType }),
  });
  if (!init.ok) throw new Error(`Google Drive не почав завантаження (HTTP ${init.status})`);
  const uploadUrl = init.headers.get('Location');
  if (!uploadUrl) throw new Error('Google Drive не повернув адресу resumable upload');

  const uploaded = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType },
    body: file,
  });
  if (!uploaded.ok) throw new Error(`Завантаження у Google Drive: HTTP ${uploaded.status}`);
  const driveFile = await uploaded.json();

  const permission = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFile.id)}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  });
  if (!permission.ok && permission.status !== 409) {
    throw new Error(`Відео завантажене, але не вдалося відкрити доступ для всіх пристроїв (HTTP ${permission.status})`);
  }
  return driveFile;
}

export async function getCachedMeta() {
  return DB.getSetting(META_KEY, null);
}

export async function refreshSharedVideo() {
  if (!isConfigured()) throw new Error('Спершу налаштуйте Cloudflare Worker у CLOUDFLARE_SETUP.md');
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
      fileId: remote.fileId,
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
  if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
    throw new Error('Оберіть відеофайл');
  }
  if (!password) throw new Error('Введіть пароль адміністратора синхронізації');

  const accessToken = await getGoogleAccessToken();
  const driveFile = await uploadFileToDrive(file, accessToken);
  await request('publish', {
    method: 'POST',
    headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: driveFile.id, resourceKey: '' }),
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
