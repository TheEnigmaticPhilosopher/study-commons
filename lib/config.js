import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export function readConfig(env = process.env) {
  const mode = env.CANVAS_MODE || 'demo';
  if (!['demo', 'live'].includes(mode)) throw new Error('CANVAS_MODE must be demo or live.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const origin = new URL(env.APP_ORIGIN || `http://localhost:${port}`);
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
  const missing = mode === 'live' ? [!baseUrl && 'CANVAS_BASE_URL', !courseId && 'CANVAS_COURSE_ID', !token && 'CANVAS_ACCESS_TOKEN'].filter(Boolean) : [];
  return {
    mode, port, origin: origin.origin, password, baseUrl, courseId, token, missing,
    dbPath: resolve(env.DATABASE_PATH || './data/study-commons.sqlite'),
    // Rotating or changing an account's token cannot expose an older account's cache.
    sourceKey: createHash('sha256').update(JSON.stringify([mode, baseUrl, courseId, token])).digest('hex'),
  };
}
