import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createCloudAuth } from './cloud-auth.js';
import { createCanvasClient, accountDemoFetch, CanvasError, validateRange } from './canvas.js';
import { saltyCatalog } from './salty.js';

const problem = (status, message) => Object.assign(new Error(message), { status });
const digest = value => createHash('sha256').update(value).digest();
async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw problem(415, 'Send application/json.');
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 32768) throw problem(413, 'Request is too large.'); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw problem(400, 'Send a JSON object.'); }
}
const publicJob = job => job ? { id: job.id, running: job.running, completed: job.completed, total: job.total,
  currentCourse: job.currentCourse || '', startedAt: job.startedAt, finishedAt: job.finishedAt, error: job.error || null }
  : { running: false, completed: 0, total: 0, currentCourse: '' };

// Every sync step is awaited before responding; no work depends on a warm process.
export function createCloudApi(config, store, { fetcher, now = Date.now, stepTimeoutMs = 220000 } = {}) {
  const auth = createCloudAuth(config, store, { now });
  const jobKey = `job-${config.accountKey}`;
  const getJob = () => store.readRecord(jobKey, null);
  const client = () => createCanvasClient(config, fetcher || (config.mode === 'demo' ? accountDemoFetch() : fetch));
  async function view() {
    const [single, account, job] = await Promise.all([store.read(config.sourceKey), store.read(config.accountKey), getJob()]);
    return { mode: config.mode, ready: !config.missing.length, missing: config.missing, syncing: false,
      baseUrl: config.baseUrl, courseId: config.courseId, ...single, accountReady: !config.accountMissing.length,
      accountMissing: config.accountMissing, account, accountJob: publicJob(job), serverlessSync: true };
  }
  async function step(jobId) {
    if (typeof jobId !== 'string' || !/^[a-f0-9]{16}$/.test(jobId)) throw problem(400, 'Choose the current import.');
    const owner = randomBytes(8).toString('hex'); const started = now();
    const job = await store.updateRecord(jobKey, null, current => {
      if (!current || current.id !== jobId) throw problem(409, 'This import is no longer current. Reload the connection.');
      if (!current.running || (current.lease && current.lease.expires > started)) return undefined;
      return { ...current, error: null, lease: { owner, expires: started + 250000 }, currentCourse: current.queue?.[current.completed]?.name || '' };
    });
    if (!job.running || job.lease?.owner !== owner) return publicJob(job);
    try {
      if (job.phase === 'discover') {
        const queue = await client().discoverCourses({ includeCompleted: job.includeCompleted, signal: AbortSignal.timeout(stepTimeoutMs) });
        const updated = await store.updateRecord(jobKey, null, current => current?.id === jobId && current.lease?.owner === owner
          ? { ...current, phase: 'courses', queue, total: queue.length, currentCourse: '', lease: null } : undefined);
        return publicJob(updated);
      }
      if (job.completed < job.total) {
        const course = job.queue[job.completed];
        const previous = await store.read(config.accountKey);
        const record = await client().syncCourse(course, job.range.start, job.range.end, {
          previousRecord: previous.snapshot?.courses.find(item => item.course.id === course.id), signal: AbortSignal.timeout(stepTimeoutMs) });
        // A lease-specific result cannot overwrite a later invocation's result.
        const resultKey = `result-${config.accountKey}-${jobId}-${owner}`;
        await store.updateRecord(resultKey, null, () => ({ jobId, record }));
        const updated = await store.updateRecord(jobKey, null, current => current?.id === jobId && current.lease?.owner === owner
          ? { ...current, completed: current.completed + 1, results: [...current.results, resultKey], currentCourse: '', lease: null } : undefined);
        return publicJob(updated);
      }
      const imported = [];
      for (let offset = 0; offset < job.results.length; offset += 8) {
        const batch = await Promise.all(job.results.slice(offset, offset + 8).map(key => store.readRecord(key, null)));
        for (const item of batch) { if (!item || item.jobId !== jobId) throw problem(503, 'An import checkpoint is missing. Retry this step.'); imported.push(item.record); }
      }
      const finishedAt = new Date(now()).toISOString();
      const snapshot = { version: 1, courses: imported, range: job.range, includeCompleted: job.includeCompleted,
        startedAt: job.startedAt, completedAt: finishedAt, warnings: imported.reduce((sum, course) => sum + course.warnings.length, 0) };
      const currentJob = await getJob();
      if (currentJob?.id !== jobId || currentJob.lease?.owner !== owner || !currentJob.running) return publicJob(currentJob);
      // Job and account records cannot be committed together. A later import's
      // generation fences out an old worker even if its lease changes immediately
      // after the check above and it resumes after that later import has published.
      await store.update(config.accountKey, saved => (saved.importGeneration || 0) > (job.generation || 0)
        ? undefined : { ...saved, snapshot, importGeneration: job.generation || 0,
          lastAttempt: job.startedAt, lastError: null });
      const updated = await store.updateRecord(jobKey, null, current => current?.id === jobId && current.lease?.owner === owner
        ? { ...current, running: false, phase: 'complete', currentCourse: '', finishedAt, lease: null, error: null } : undefined);
      return publicJob(updated);
    } catch (error) {
      const message = error instanceof CanvasError || error.status ? error.message : 'The import step could not be saved. Retry to resume.';
      await store.updateRecord(jobKey, null, current => current?.id === jobId && current.lease?.owner === owner
        ? { ...current, lease: null, currentCourse: '', error: message } : undefined);
      // Step errors belong to the fenced job record. A stale worker must not mark
      // a subsequently published account snapshot as failed.
      throw problem(502, message);
    }
  }
  const handler = async (request, response, path) => {
    if (!path.startsWith('/api/')) return false;
    const send = (status, value) => {
      let json = JSON.stringify(value);
      if (Buffer.byteLength(json) > 4 * 1024 * 1024) { status = 413; json = JSON.stringify({ error: 'This account view exceeds the hosting response limit. Sync available courses only.' }); }
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(json);
    };
    try {
      if (!['GET', 'POST'].includes(request.method)) throw problem(405, 'Method not allowed.');
      if (request.method === 'POST' && request.headers.origin !== config.origin) throw problem(403, 'Open the configured app address to make changes.');
      if (path === '/api/integrations/salty/courses') {
        if (request.method !== 'GET') throw problem(405, 'This connector is read-only.');
        if (!config.saltyToken || typeof request.headers.authorization !== 'string' || !timingSafeEqual(digest(request.headers.authorization), digest(`Bearer ${config.saltyToken}`))) throw problem(401, 'Connector credential rejected.');
        const params = new URL(request.url, config.origin).searchParams; const ids = [...new Set(params.getAll('course_id'))];
        if (!ids.length || ids.length > 150 || ids.some(id => !/^\d+$/.test(id)) || [...params.keys()].some(key => key !== 'course_id')) throw problem(400, 'Request explicit numeric course_id values.');
        if (ids.some(id => !config.saltyCourseIds.includes(id))) throw problem(403, 'A requested course is outside the connector scope.');
        send(200, saltyCatalog(config, await store.read(config.accountKey), ids, (await getJob())?.running)); return true;
      }
      const session = await auth.authenticate(request);
      if (path === '/api/session' && request.method === 'GET') { send(200, { authenticated: Boolean(session), loginConfigured: Boolean(config.password) }); return true; }
      if (path === '/api/login' && request.method === 'POST') {
        const signedIn = await auth.login((await readJson(request)).password, session);
        response.setHeader('Set-Cookie', signedIn.cookie); send(200, { authenticated: true }); return true;
      }
      if (!session) throw problem(401, 'Sign in to view your private Canvas data.');
      if (path === '/api/logout' && request.method === 'POST') { response.setHeader('Set-Cookie', (await auth.logout(session)).cookie); send(200, { authenticated: false }); return true; }
      if (path === '/api/canvas' && request.method === 'GET') { send(200, await view()); return true; }
      if (path === '/api/canvas/sync-all' && request.method === 'POST') {
        if (config.accountMissing.length) throw problem(503, 'Complete the private Canvas environment settings.');
        const body = await readJson(request); const range = validateRange(body.start, body.end);
        if (body.includeCompleted !== undefined && typeof body.includeCompleted !== 'boolean') throw problem(400, 'includeCompleted must be true or false.');
        const id = randomBytes(8).toString('hex'); const startedAt = new Date(now()).toISOString();
        await store.updateRecord(jobKey, null, current => {
          if (current?.running) throw problem(409, 'An import is already saved. Resume it to continue.');
          return { id, generation: (current?.generation || 0) + 1, running: true, completed: 0, total: 0, currentCourse: '', phase: 'discover', queue: [], results: [],
            range, includeCompleted: body.includeCompleted !== false, startedAt, lease: null, error: null };
        });
        send(202, await view()); return true;
      }
      if (path === '/api/canvas/sync-step' && request.method === 'POST') { send(200, { accountJob: await step((await readJson(request)).jobId) }); return true; }
      if (path === '/api/canvas/course-mapping' && request.method === 'POST') {
        const body = await readJson(request);
        await store.update(config.accountKey, saved => {
          const course = saved.snapshot?.courses.find(item => item.course.id === body.courseId);
          if (!course?.events.some(event => event.id === body.eventId) || (body.moduleId !== '' && !course.modules.some(module => module.id === body.moduleId))) throw problem(400, 'Choose an event and module from the same imported course.');
          const mappings = saved.mappings.filter(item => !(item.courseId === body.courseId && item.eventId === body.eventId));
          if (body.moduleId) mappings.push({ courseId: body.courseId, eventId: body.eventId, moduleId: body.moduleId });
          return { ...saved, mappings };
        });
        send(200, await view()); return true;
      }
      if (path === '/api/canvas/sync' || path === '/api/canvas/mapping') throw problem(409, 'Use the all-course importer and original Canvas modules on this deployment.');
      throw problem(404, 'API endpoint not found.');
    } catch (error) {
      if (process.env.VERCEL && !error.status && !(error instanceof CanvasError)) console.error('Private API failure', JSON.stringify({
        type: /^[A-Za-z]{1,80}$/.test(error?.constructor?.name || '') ? error.constructor.name : 'Unknown',
        frames: String(error.stack || '').split('\n').slice(1, 4),
      }));
      send(error.status || (error instanceof CanvasError ? 400 : 503), { error: error.status || error instanceof CanvasError ? error.message : 'Private storage is unavailable. Try again later.' });
    }
    return true;
  };
  handler.close = () => {};
  return handler;
}
