import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createCanvasClient, demoFetch, CanvasError, validateRange } from './canvas.js';
import { courses } from '../public/data.js';

const digest = value => createHash('sha256').update(value).digest();
const problem = (status, message) => Object.assign(new Error(message), { status });
async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw problem(415, 'Send application/json.');
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32768) throw problem(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { throw problem(400, 'Send a JSON object.'); }
}

export function createApi(config, store, { fetcher } = {}) {
  const sessions = new Map();
  let loginAttempts = []; let syncing = false;
  function session(request) {
    const key = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('hub_session='))?.slice(12);
    const expires = sessions.get(key);
    if (!expires || expires <= Date.now()) { sessions.delete(key); return null; }
    return key;
  }
  function cookie(value, age) {
    return `hub_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.origin.startsWith('https:') ? '; Secure' : ''}`;
  }
  function view() {
    return { mode: config.mode, ready: !config.missing.length, missing: config.missing, syncing,
      baseUrl: config.baseUrl, courseId: config.courseId, ...store.read(config.sourceKey) };
  }
  return async function api(request, response, path) {
    if (!path.startsWith('/api/')) return false;
    const send = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    try {
      if (!['GET', 'POST'].includes(request.method)) throw problem(405, 'Method not allowed.');
      if (request.method === 'POST' && request.headers.origin !== config.origin) throw problem(403, 'Request origin does not match APP_ORIGIN. Open the configured app address.');
      const authenticated = session(request);
      if (path === '/api/session' && request.method === 'GET') {
        send(200, { authenticated: Boolean(authenticated), loginConfigured: Boolean(config.password) }); return true;
      }
      if (path === '/api/login' && request.method === 'POST') {
        if (!config.password) throw problem(503, 'Set HUB_ADMIN_PASSWORD on the server to enable the private demo.');
        loginAttempts = loginAttempts.filter(time => Date.now() - time < 300000);
        if (loginAttempts.length >= 20) throw problem(429, 'Too many sign-in attempts. Try again in five minutes.');
        const body = await readJson(request);
        loginAttempts.push(Date.now());
        if (typeof body.password !== 'string' || !timingSafeEqual(digest(body.password), digest(config.password))) throw problem(401, 'Incorrect demo password.');
        if (authenticated) sessions.delete(authenticated);
        for (const [key, expiry] of sessions) if (expiry < Date.now()) sessions.delete(key);
        if (sessions.size >= 16) sessions.delete(sessions.keys().next().value);
        const key = randomBytes(32).toString('hex');
        sessions.set(key, Date.now() + 8 * 3600000);
        response.setHeader('Set-Cookie', cookie(key, 8 * 3600));
        send(200, { authenticated: true }); return true;
      }
      if (!authenticated) throw problem(401, 'Sign in to view your private Canvas data.');
      if (path === '/api/logout' && request.method === 'POST') {
        sessions.delete(authenticated);
        response.setHeader('Set-Cookie', cookie('', 0));
        send(200, { authenticated: false }); return true;
      }
      if (path === '/api/canvas' && request.method === 'GET') { send(200, view()); return true; }
      if (path === '/api/canvas/sync' && request.method === 'POST') {
        if (config.missing.length) throw problem(503, 'Complete the Canvas settings in your server secrets, then restart.');
        if (syncing) throw problem(409, 'A sync is already running.');
        const body = await readJson(request);
        validateRange(body.start, body.end);
        if (body.scenario && !['original', 'rescheduled'].includes(body.scenario)) throw problem(400, 'Unknown demo scenario.');
        if (syncing) throw problem(409, 'A sync is already running.');
        syncing = true;
        const attemptedAt = new Date().toISOString();
        try {
          const client = createCanvasClient(config, fetcher || (config.mode === 'demo' ? demoFetch(body.scenario) : fetch));
          const snapshot = await client.sync(body.start, body.end);
          // Read mappings after fetching so an edit during sync is not lost.
          const saved = store.read(config.sourceKey);
          store.write(config.sourceKey, { ...saved, snapshot, lastAttempt: attemptedAt, lastError: null });
        } catch (error) {
          const saved = store.read(config.sourceKey);
          const message = error instanceof CanvasError ? error.message : 'Sync failed. The last successful snapshot was kept.';
          store.write(config.sourceKey, { ...saved, lastAttempt: attemptedAt, lastError: message });
          throw problem(502, message);
        } finally { syncing = false; }
        send(200, view()); return true;
      }
      if (path === '/api/canvas/mapping' && request.method === 'POST') {
        const body = await readJson(request);
        const saved = store.read(config.sourceKey);
        const collection = body.kind === 'module' ? saved.snapshot?.modules : body.kind === 'event' ? saved.snapshot?.events : null;
        if (!collection?.some(item => item.id === body.sourceId)) throw problem(400, 'Select a record from the latest successful sync.');
        const course = courses.find(item => item.id === body.courseId);
        if (body.unitId && (!course || !course.units.some(item => item.id === body.unitId))) throw problem(400, 'Select a valid study-hub course and unit.');
        if (body.unitId !== '' && typeof body.unitId !== 'string') throw problem(400, 'Select a unit, or choose Unlinked.');
        saved.mappings = saved.mappings.filter(item => !(item.kind === body.kind && item.sourceId === body.sourceId));
        if (body.unitId) saved.mappings.push({ kind: body.kind, sourceId: body.sourceId, courseId: body.courseId, unitId: body.unitId });
        store.write(config.sourceKey, saved);
        send(200, view()); return true;
      }
      throw problem(404, 'API endpoint not found.');
    } catch (error) {
      send(error.status || (error instanceof CanvasError ? 400 : 500), { error: error.status || error instanceof CanvasError ? error.message : 'The server could not complete this request.' });
    }
    return true;
  };
}
