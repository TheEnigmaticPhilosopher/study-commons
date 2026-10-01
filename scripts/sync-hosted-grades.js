import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const env = parseEnv(readFileSync('.env', 'utf8'));
// Credentials may only be sent to this pilot, never to an arbitrary CLI URL.
const origin = 'https://study-commons-pilot.vercel.app';
let cookie = '';
async function call(path, body) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { Origin: origin, Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180000) });
  if (path === '/api/login' && response.ok) cookie = response.headers.get('set-cookie').split(';')[0];
  const text = await response.text();
  assert.ok(!text.includes(env.CANVAS_ACCESS_TOKEN)); assert.ok(!text.includes(env.HUB_ADMIN_PASSWORD));
  if (!response.ok) throw Error(`Pilot request failed (${response.status})`);
  return JSON.parse(text);
}
await call('/api/login', { password: env.HUB_ADMIN_PASSWORD });
try {
  const { account, grades: savedGrades = {} } = await call('/api/canvas');
  const counts = { courses: account.snapshot.courses.length, synced: 0, unavailable: 0, failed: 0, numericGrades: 0, postedAssignments: 0 };
  for (const [index, item] of account.snapshot.courses.entries()) {
    try {
      const grades = process.argv.includes('--resume') && savedGrades[item.course.id] ? savedGrades[item.course.id]
        : (await call('/api/canvas/grades', { courseId: item.course.id })).grades;
      counts[grades.status === 'synced' ? 'synced' : 'unavailable']++;
      if (typeof grades.currentScore === 'number') counts.numericGrades++;
      counts.postedAssignments += grades.assignments.filter(item => typeof item.score === 'number').length;
    } catch { counts.failed++; }
    console.log(`Grade refresh ${index + 1}/${counts.courses}; ${counts.synced} accessible, ${counts.unavailable} unavailable, ${counts.failed} failed.`);
  }
  const saved = await call('/api/canvas');
  assert.equal(Object.keys(saved.grades).length, counts.synced + counts.unavailable);
  console.log(JSON.stringify({ verified: true, ...counts }));
  if (counts.failed) process.exitCode = 1;
} finally { await call('/api/logout', {}); }
