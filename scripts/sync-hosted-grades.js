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
  const before = await call('/api/canvas');
  assert.equal(before.gradeMode, 'demo', 'Deploy the sample-grade release first.');
  const first = before.account.snapshot.courses[0];
  if (first) await call('/api/canvas/grades', {courseId:first.course.id});
  const after = await call('/api/canvas');
  assert.deepEqual(after.account, before.account, 'Class materials must be unchanged.');
  const grades = Object.values(after.grades);
  assert.ok(grades.every(item => item.isDemo && item.status === 'demo'));
  assert.ok(grades.every(item => item.assignments.every(assignment => assignment.isDemo)));
  console.log(JSON.stringify({verified:true,realCourses:after.account.snapshot.courses.length,sampleGradeCourses:grades.length,sampleAssignmentScores:grades.reduce((sum,item)=>sum+item.assignments.length,0),realGradeImportDisabled:true,oldGradeRecordReplaced:true}));
} finally { await call('/api/logout', {}); }
