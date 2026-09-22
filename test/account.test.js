import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { readConfig } from '../lib/config.js';
import { createCanvasClient, accountDemoFetch } from '../lib/canvas.js';
import { createAppServer } from '../server.js';
import { accountCards, accountCourseView } from '../public/canvas-account.js';

const range = { start: '2027-03-01', end: '2027-03-31' };
const password = 'account-test-fixture-password';

test('account import discovers courses and attaches every resource category to its actual course', async () => {
  const config = readConfig({}); const seen = [];
  const fixture = accountDemoFetch();
  const client = createCanvasClient(config, async (input, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    const url = new URL(input); seen.push(url);
    assert.equal(url.origin, config.baseUrl);
    return fixture(input, options);
  });
  const snapshot = await client.syncAccount(range.start, range.end);
  assert.equal(snapshot.courses.length, 2);
  assert.equal(snapshot.warnings, 0);
  for (const entry of snapshot.courses) {
    for (const key of ['modules', 'assignments', 'pages', 'files', 'announcements', 'discussions', 'quizzes']) {
      assert.ok(entry[key].length, key);
      assert.equal(entry.collections[key].status, 'synced');
    }
    assert.match(entry.files[0].url, new RegExp(`/courses/${entry.course.id}/files/81$`));
    assert.match(entry.pages[0].url, new RegExp(`/courses/${entry.course.id}/pages/study-guide$`));
    assert.match(entry.assignments[0].url, new RegExp(`/courses/${entry.course.id}/assignments/91$`));
  }
  assert.equal(JSON.stringify(snapshot).includes('private-download.example'), false);
  assert.deepEqual(seen[0].searchParams.getAll('state[]'), ['available', 'completed']);
  const onlyAvailable = await client.syncAccount(range.start, range.end, { includeCompleted: false });
  assert.deepEqual(onlyAvailable.courses.map(item => item.course.id), ['12345']);
});

test('course and item removal is reconciled and equal module IDs in different courses stay distinct', async () => {
  let removed = false;
  const fixture = accountDemoFetch();
  const client = createCanvasClient(readConfig({}), async (input, options) => {
    const path = new URL(input).pathname;
    const response = await fixture(input, options);
    if (!removed) return response;
    if (path === '/api/v1/courses') return Response.json((await response.json()).filter(course => course.id === 12345));
    if (path.endsWith('/files')) return Response.json([]);
    return response;
  });
  const previous = await client.syncAccount(range.start, range.end);
  assert.equal(previous.courses[0].modules[8].id, previous.courses[1].modules[0].id);
  assert.notEqual(previous.courses[0].modules[8].items[0].url, previous.courses[1].modules[0].items[0].url);
  removed = true;
  const next = await client.syncAccount(range.start, range.end, { previous });
  assert.equal(next.courses.length, 1);
  assert.equal(next.courses[0].files.length, 0);
});

test('denied categories clear old content while temporary failures keep explicitly stale data', async () => {
  let failure = false;
  const fixture = accountDemoFetch();
  const client = createCanvasClient(readConfig({}), async (input, options) => {
    const path = new URL(input).pathname;
    if (failure && path.endsWith('/files')) return Response.json({ secret: 'do-not-reflect' }, { status: 403 });
    if (failure && path.endsWith('/pages')) return Response.json({}, { status: 503 });
    if (failure && path.endsWith('/calendar_events')) return Response.json({}, { status: 503 });
    return fixture(input, options);
  });
  const previous = await client.syncAccount(range.start, range.end);
  failure = true;
  const next = await client.syncAccount(range.start, range.end, { previous });
  for (const entry of next.courses) {
    const old = previous.courses.find(item => item.course.id === entry.course.id);
    assert.equal(entry.files.length, 0);
    assert.equal(entry.collections.files.status, 'unavailable');
    assert.deepEqual(entry.pages, old.pages);
    assert.equal(entry.collections.pages.status, 'failed');
    assert.equal(entry.collections.pages.syncedAt, old.collections.pages.syncedAt);
    assert.equal(entry.syncedAt, old.syncedAt);
    assert.equal(entry.warnings.length, 3);
  }
  assert.equal(JSON.stringify(next).includes('do-not-reflect'), false);
  const newWindow = await client.syncAccount('2027-04-01', '2027-04-30', { previous });
  assert.equal(newWindow.courses[0].events.length, 0, 'old dates must not be represented as the new date window');
});

test('course-list pagination preserves repeated state parameters; auth failures abort the import', async () => {
  const fixture = accountDemoFetch(); const states = [];
  let fail = false;
  const client = createCanvasClient(readConfig({}), async (input, options) => {
    const url = new URL(input);
    if (url.pathname === '/api/v1/courses') {
      states.push(url.searchParams.getAll('state[]'));
      if (!url.searchParams.has('page')) return Response.json([], { headers: { Link: '<https://canvas.example.test/api/v1/courses?page=2>; rel="next"' } });
    }
    if (fail && url.pathname.endsWith('/pages')) return Response.json({}, { status: 401 });
    return fixture(input, options);
  });
  assert.equal((await client.syncAccount(range.start, range.end)).courses.length, 2);
  assert.deepEqual(states, [['available', 'completed'], ['available', 'completed']]);
  fail = true;
  await assert.rejects(() => client.syncAccount(range.start, range.end), /access token/);
});

test('dashboard and resource views keep original course links and escape untrusted Canvas titles', async () => {
  const snapshot = await createCanvasClient(readConfig({}), accountDemoFetch()).syncAccount(range.start, range.end);
  snapshot.courses[0].course.name = '<img src=x onerror=alert(1)>';
  const data = { mode: 'live', account: { snapshot, mappings: [], lastError: null } };
  const cards = accountCards(data);
  assert.match(cards, /#canvas-course\/12345\/modules/);
  assert.match(cards, /#canvas-course\/23456\/modules/);
  assert.ok(cards.includes('&lt;img'));
  assert.ok(!cards.includes('<img src=x'));
  const files = accountCourseView(data, '23456', 'files');
  assert.match(files, /courses\/23456\/files\/81/);
  assert.ok(!files.includes('/courses/12345/files/81'));
  assert.match(accountCourseView(null, '12345'), /Sign in/);
});

test('account API runs a background import, saves mappings by course, and protects the result', async t => {
  const config = readConfig({ HUB_ADMIN_PASSWORD: password });
  let fail = false;
  const fixture = accountDemoFetch();
  const server = createAppServer({ config, fetcher: (input, options) => fail ? Response.json({}, { status: 401 }) : fixture(input, options) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  let cookie = '';
  async function call(path, body) {
    const response = await fetch(`${config.origin}/api/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, Origin: config.origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  async function complete() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = (await call('canvas')).data;
      if (!current.accountJob.running) return current;
      await pause(10);
    }
    throw new Error('Fixture job did not finish');
  }
  assert.equal((await call('canvas/sync-all', range)).status, 401);
  await call('login', { password });
  assert.equal((await call('canvas/sync-all', range)).status, 202);
  const first = await complete();
  assert.equal(first.account.snapshot.courses.length, 2);
  assert.equal(JSON.stringify(first).includes(config.token), false);
  const mapping = { courseId: '12345', eventId: '9001', moduleId: '109' };
  assert.equal((await call('canvas/course-mapping', mapping)).status, 200);
  assert.equal((await call('canvas/course-mapping', { ...mapping, courseId: '23456' })).status, 400);
  await call('canvas/sync-all', range);
  assert.deepEqual((await complete()).account.mappings, [mapping]);
  fail = true;
  const beforeFailure = (await call('canvas')).data.account.snapshot;
  await call('canvas/sync-all', range);
  const afterFailure = await complete();
  assert.deepEqual(afterFailure.account.snapshot, beforeFailure);
  assert.match(afterFailure.account.lastError, /access token/);
  await call('logout', {});
  assert.equal((await call('canvas')).status, 401);
});

test('account sync does not require a hardcoded course ID', () => {
  const config = readConfig({ CANVAS_MODE: 'live', CANVAS_BASE_URL: 'https://canvas.example.test', CANVAS_ACCESS_TOKEN: 'fictional' });
  assert.deepEqual(config.accountMissing, []);
  assert.deepEqual(config.missing, ['CANVAS_COURSE_ID']);
});
