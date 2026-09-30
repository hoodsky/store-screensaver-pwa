const MANIFEST_KEY = 'current-video';
const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = origin === env.ALLOWED_ORIGIN;
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

function isAdmin(request, env) {
  return Boolean(env.ADMIN_PASSWORD) && request.headers.get('Authorization') === `Bearer ${env.ADMIN_PASSWORD}`;
}

function parseDriveLink(link) {
  let url;
  try { url = new URL(link); } catch { throw new Error('Посилання Google Drive некоректне'); }
  if (url.hostname !== 'drive.google.com' && url.hostname !== 'docs.google.com') {
    throw new Error('Вставте посилання з Google Drive');
  }
  const match = url.pathname.match(/\/file\/d\/([^/]+)/);
  const fileId = match?.[1] || url.searchParams.get('id');
  if (!fileId || !/^[\w-]+$/.test(fileId)) throw new Error('Не вдалося знайти ID файла у посиланні');
  return { fileId, resourceKey: url.searchParams.get('resourcekey') || '' };
}

function driveUrl(fileId, env, media = false) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('key', env.DRIVE_API_KEY);
  if (media) {
    url.searchParams.set('alt', 'media');
  } else {
    url.searchParams.set('fields', 'id,name,mimeType,size,modifiedTime,md5Checksum,trashed');
  }
  return url;
}

async function getDriveMetadata(fileId, resourceKey, env) {
  const headers = resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${fileId}/${resourceKey}` } : {};
  const response = await fetch(driveUrl(fileId, env), { headers });
  if (!response.ok) throw new Error(`Google Drive metadata HTTP ${response.status}; перевірте Anyone with the link`);
  const meta = await response.json();
  if (meta.trashed) throw new Error('Відеофайл переміщено в кошик Google Drive');
  if (!String(meta.mimeType || '').startsWith('video/')) throw new Error('Обраний файл не є відео');
  if (Number(meta.size) > MAX_VIDEO_BYTES) throw new Error('Відео перевищує ліміт 5 ГБ');
  return meta;
}

async function publishDriveFile(env, fileId, resourceKey, managedByApp = false) {
  const meta = await getDriveMetadata(fileId, resourceKey, env);
  const manifest = {
    fileId: meta.id,
    resourceKey: resourceKey || '',
    fileName: String(meta.name || 'video').replace(/[\r\n]/g, '').slice(0, 200),
    mimeType: meta.mimeType || 'video/mp4',
    size: Number(meta.size || 0),
    etag: meta.md5Checksum || meta.modifiedTime || new Date().toISOString(),
    modifiedAt: meta.modifiedTime || '',
    managedByApp,
  };
  const previous = await env.VIDEO_META.get(MANIFEST_KEY, 'json');
  const unchanged = previous &&
    previous.fileId === manifest.fileId &&
    previous.resourceKey === manifest.resourceKey &&
    previous.fileName === manifest.fileName &&
    previous.mimeType === manifest.mimeType &&
    previous.size === manifest.size &&
    previous.etag === manifest.etag &&
    previous.managedByApp === manifest.managedByApp;
  if (!unchanged) await env.VIDEO_META.put(MANIFEST_KEY, JSON.stringify(manifest));
  return manifest;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      if (origin !== env.ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }
    if (origin && origin !== env.ALLOWED_ORIGIN) return json({ error: 'Origin not allowed' }, 403, cors);

    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname.endsWith('/manifest')) {
        const manifest = await env.VIDEO_META.get(MANIFEST_KEY, 'json');
        if (!manifest) return json({ error: 'Спільне відео ще не задано' }, 404, cors);
        if (!env.DRIVE_API_KEY) return json({ error: 'Drive API key не налаштовано у Worker' }, 503, cors);
        return json(await publishDriveFile(env, manifest.fileId, manifest.resourceKey, Boolean(manifest.managedByApp)), 200, cors);
      }

      if (request.method === 'GET' && url.pathname.endsWith('/video')) {
        const manifest = await env.VIDEO_META.get(MANIFEST_KEY, 'json');
        if (!manifest) return json({ error: 'Спільне відео ще не задано' }, 404, cors);
        const headers = manifest.resourceKey
          ? { 'X-Goog-Drive-Resource-Keys': `${manifest.fileId}/${manifest.resourceKey}` }
          : {};
        const response = await fetch(driveUrl(manifest.fileId, env, true), { headers });
        if (!response.ok || !response.body) {
          return json({ error: `Не вдалося завантажити відео з Drive (HTTP ${response.status})` }, 502, cors);
        }
        return new Response(response.body, {
          headers: {
            'Content-Type': manifest.mimeType || response.headers.get('Content-Type') || 'video/mp4',
            'Content-Length': String(manifest.size || response.headers.get('Content-Length') || ''),
            'ETag': `"${manifest.etag}"`,
            'Cache-Control': 'public, max-age=300',
            ...cors,
          },
        });
      }

      if (request.method === 'POST' && url.pathname.endsWith('/import-drive')) {
        if (!isAdmin(request, env)) return json({ error: 'Неправильний пароль адміністратора' }, 401, cors);
        if (!env.DRIVE_API_KEY) return json({ error: 'Drive API key не налаштовано у Worker' }, 503, cors);
        const { link } = await request.json();
        const { fileId, resourceKey } = parseDriveLink(String(link || ''));
        return json(await publishDriveFile(env, fileId, resourceKey), 200, cors);
      }

      if (request.method === 'POST' && url.pathname.endsWith('/publish')) {
        if (!isAdmin(request, env)) return json({ error: 'Неправильний пароль адміністратора' }, 401, cors);
        if (!env.DRIVE_API_KEY) return json({ error: 'Drive API key не налаштовано у Worker' }, 503, cors);
        const { fileId, resourceKey = '' } = await request.json();
        if (!/^[\w-]+$/.test(String(fileId || ''))) return json({ error: 'ID файла Google Drive некоректний' }, 400, cors);
        const manifest = await publishDriveFile(env, String(fileId), String(resourceKey), true);
        return json(manifest, 200, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      console.error('Shared video worker error:', error);
      return json({ error: error.message || 'Internal error' }, 500, cors);
    }
  },
};
