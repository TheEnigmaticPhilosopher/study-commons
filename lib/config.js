import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export function readConfig(env = process.env) {
  const mode = env.CANVAS_MODE || 'demo';
  if (!['demo', 'live'].includes(mode)) throw new Error('CANVAS_MODE must be demo or live.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const origin = new URL(env.APP_ORIGIN || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://localhost:${port}`));
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new Error('APP_ORIGIN must be an HTTPS origin, or HTTP localhost for development.');
  }
  const password = env.HUB_ADMIN_PASSWORD || '';
  if (password && password.length < 16) throw new Error('HUB_ADMIN_PASSWORD must be at least 16 characters.');
  let baseUrl = mode === 'demo' ? 'https://canvas.example.test' : (env.CANVAS_BASE_URL || '');
  const courseId = mode === 'demo' ? '12345' : (env.CANVAS_COURSE_ID || '');
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('CANVAS_BASE_URL must be an HTTPS origin without a course path.');
    }
    baseUrl = url.origin;
  }
  if (courseId && !/^\d+$/.test(courseId)) throw new Error('CANVAS_COURSE_ID must contain only digits.');
  const token = mode === 'demo' ? 'fixture-only-not-a-real-token' : (env.CANVAS_ACCESS_TOKEN || '');
  const saltyToken = env.SALTY_CONNECTOR_TOKEN || '';
  const saltyCourseIds = [...new Set((env.SALTY_COURSE_IDS || '').split(',').map(value => value.trim()).filter(Boolean))];
  if (saltyToken && (saltyToken.length < 32 || saltyToken === token || saltyToken === password)) throw new Error('SALTY_CONNECTOR_TOKEN must be a separate secret of at least 32 characters.');
  if (saltyCourseIds.some(value => !/^\d+$/.test(value)) || saltyCourseIds.length > 150) throw new Error('SALTY_COURSE_IDS must contain at most 150 comma-separated numeric course IDs.');
  if (saltyToken && !saltyCourseIds.length) throw new Error('Set SALTY_COURSE_IDS to explicitly allow courses for the connector.');
  const accountMissing = mode === 'live' ? [!baseUrl && 'CANVAS_BASE_URL', !token && 'CANVAS_ACCESS_TOKEN'].filter(Boolean) : [];
  const missing = [...accountMissing, ...(!courseId ? ['CANVAS_COURSE_ID'] : [])];
  const storageDriver = env.STORAGE_DRIVER || (env.VERCEL ? 'blob' : 'sqlite');
  if (!['sqlite', 'blob'].includes(storageDriver)) throw new Error('STORAGE_DRIVER must be sqlite or blob.');
  if (env.VERCEL && storageDriver !== 'blob') throw new Error('Vercel requires private durable storage. Set STORAGE_DRIVER=blob.');
  if (storageDriver === 'blob' && !env.BLOB_STORE_ID && !env.BLOB_READ_WRITE_TOKEN) throw new Error('Connect a private Vercel Blob store before starting the hosted pilot.');
  return {
    mode, port, origin: origin.origin, password, baseUrl, courseId, token, missing, accountMissing, saltyToken, saltyCourseIds,
    dbPath: resolve(env.DATABASE_PATH || './data/study-commons.sqlite'), storageDriver,
    blobStoreId: env.BLOB_STORE_ID || undefined, blobToken: env.BLOB_READ_WRITE_TOKEN || undefined,
    // Rotating or changing an account's token cannot expose an older account's cache.
    sourceKey: createHash('sha256').update(JSON.stringify([mode, baseUrl, courseId, token])).digest('hex'),
    accountKey: createHash('sha256').update(JSON.stringify(['account-v1', mode, baseUrl, token])).digest('hex'),
  };
}
