import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { validateRange } from '../lib/canvas.js';

const origin = new URL(process.argv[2]);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('Provide the exact HTTPS production origin.');
}
const range = validateRange(process.argv[3], process.argv[4]);
const password = parseEnv(readFileSync('.env', 'utf8')).HUB_ADMIN_PASSWORD;
if (!password) throw new Error('The local pilot password is not configured.');
let cookie = '';
async function api(path, body) {
  const response = await fetch(new URL(`/api/${path}`, origin), {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { Origin: origin.origin, ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(290000),
  });
  if (path === 'login' && response.ok) cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(`Hosted ${path} request failed (HTTP ${response.status}). Check the private connection screen.`);
  return result;
}
try {
  await api('login', { password });
  let state = await api('canvas');
  if (state.mode !== 'live' || !state.serverlessSync || !state.accountReady) throw new Error('The hosted live importer is not configured.');
  if (!state.accountJob.running) state = await api('canvas/sync-all', { ...range, includeCompleted: true });
  let job = state.accountJob;
  console.log(`Resuming hosted import: ${job.completed}/${job.total || '?'} courses processed.`);
  while (job.running) {
    const previous = job.completed;
    job = (await api('canvas/sync-step', { jobId: job.id })).accountJob;
    console.log(`Hosted import: ${job.completed}/${job.total || '?'}${job.running ? '' : ' complete'}`);
    // Another browser may hold the lease. Avoid hammering durable storage.
    if (job.running && job.completed === previous) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const saved = (await api('canvas')).account.snapshot;
  const categories = ['modules', 'assignments', 'pages', 'files', 'announcements', 'discussions', 'quizzes', 'events'];
  console.log(JSON.stringify({ completedAt: saved.completedAt, courses: saved.courses.length, warnings: saved.warnings,
    counts: Object.fromEntries(categories.map(key => [key, saved.courses.reduce((sum, course) => sum + (course[key]?.length || 0), 0)])) }));
} finally {
  if (cookie) await api('logout', {}).catch(() => console.error('Could not revoke the import session; it expires automatically.'));
}
