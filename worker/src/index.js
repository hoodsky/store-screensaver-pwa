import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const VIDEO_KEY = 'videos/current';
const MANIFEST_KEY = 'videos/manifest.json';
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

function client(env) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
}

function isAdmin(request, env) {
  const supplied = request.headers.get('Authorization') || '';
  return supplied === `Bearer ${env.ADMIN_PASSWORD}`;
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

async function publishManifest(env, fileName = '') {
  const head = await env.MEDIA.head(VIDEO_KEY);
  if (!head) throw new Error('Відео ще не завантажено');
  const manifest = {
    etag: head.etag,
    fileName: fileName || head.customMetadata?.fileName || 'video',
    size: head.size,
    contentType: head.httpMetadata?.contentType || 'video/mp4',
    modifiedAt: head.uploaded?.toISOString?.() || new Date().toISOString(),
  };
  await env.MEDIA.put(MANIFEST_KEY, JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
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
        const object = await env.MEDIA.get(MANIFEST_KEY);
        if (!object) return json({ error: 'Shared video has not been uploaded yet' }, 404, cors);
        return new Response(object.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });
      }

      if (request.method === 'GET' && url.pathname.endsWith('/video')) {
        const object = await env.MEDIA.get(VIDEO_KEY);
        if (!object) return json({ error: 'Shared video has not been uploaded yet' }, 404, cors);
        const headers = new Headers({
          'Content-Type': object.httpMetadata?.contentType || 'video/mp4',
          'Content-Length': String(object.size),
          'ETag': `"${object.etag}"`,
          'Cache-Control': 'public, max-age=300',
          ...cors,
        });
        return new Response(object.body, { headers });
      }

      if (request.method === 'POST' && url.pathname.endsWith('/upload-url')) {
        if (!isAdmin(request, env)) return json({ error: 'Неправильний пароль адміністратора' }, 401, cors);
        const body = await request.json();
        if (!String(body.contentType || '').startsWith('video/')) return json({ error: 'Оберіть відеофайл' }, 400, cors);
        if (!Number.isFinite(body.size) || body.size <= 0 || body.size > MAX_VIDEO_BYTES) {
          return json({ error: 'Розмір відео має бути від 1 байта до 5 ГБ' }, 413, cors);
        }
        const s3 = client(env);
        const command = new PutObjectCommand({
          Bucket: env.R2_BUCKET_NAME,
          Key: VIDEO_KEY,
          ContentType: body.contentType,
        });
        const signedUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
        return json({ url: signedUrl }, 200, cors);
      }

      if (request.method === 'POST' && url.pathname.endsWith('/complete')) {
        if (!isAdmin(request, env)) return json({ error: 'Неправильний пароль адміністратора' }, 401, cors);
        const { fileName = '' } = await request.json();
        const manifest = await publishManifest(env, String(fileName).replace(/[\r\n]/g, '').slice(0, 200));
        return json(manifest, 200, cors);
      }

      if (request.method === 'POST' && url.pathname.endsWith('/import-drive')) {
        if (!isAdmin(request, env)) return json({ error: 'Неправильний пароль адміністратора' }, 401, cors);
        if (!env.DRIVE_API_KEY) return json({ error: 'Drive API key не налаштовано у Worker' }, 503, cors);
        const { link } = await request.json();
        const { fileId, resourceKey } = parseDriveLink(String(link || ''));
        const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
        const params = new URLSearchParams({ key: env.DRIVE_API_KEY, fields: 'id,name,mimeType,size,trashed' });
        const driveHeaders = resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${fileId}/${resourceKey}` } : {};
        const metaResponse = await fetch(`${base}?${params}`, { headers: driveHeaders });
        if (!metaResponse.ok) return json({ error: `Google Drive metadata HTTP ${metaResponse.status}; перевірте Anyone with the link` }, 502, cors);
        const meta = await metaResponse.json();
        if (meta.trashed) return json({ error: 'Файл Google Drive переміщено в кошик' }, 400, cors);
        if (!String(meta.mimeType || '').startsWith('video/')) return json({ error: 'Обране посилання не веде на відео' }, 400, cors);
        if (Number(meta.size) > MAX_VIDEO_BYTES) return json({ error: 'Відео перевищує ліміт 5 ГБ' }, 413, cors);
        const paramsMedia = new URLSearchParams({ key: env.DRIVE_API_KEY, alt: 'media' });
        const media = await fetch(`${base}?${paramsMedia}`, { headers: driveHeaders });
        if (!media.ok || !media.body) return json({ error: `Не вдалося завантажити відео з Drive (HTTP ${media.status})` }, 502, cors);
        await env.MEDIA.put(VIDEO_KEY, media.body, {
          httpMetadata: { contentType: meta.mimeType },
          customMetadata: { fileName: String(meta.name || 'video').slice(0, 200) },
        });
        return json(await publishManifest(env, meta.name || 'video'), 200, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      console.error('Shared video worker error:', error);
      return json({ error: error.message || 'Internal error' }, 500, cors);
    }
  },
};
