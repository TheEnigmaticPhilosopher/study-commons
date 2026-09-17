import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../server.js';
import { readConfig } from '../lib/config.js';
import { createStore } from '../lib/store.js';
import { createCanvasClient, demoFetch, validateRange } from '../lib/canvas.js';
import { formatCanvasDate } from '../public/canvas.js';

const password = 'test-password-for-fixtures-only';
const range = { start: '2027-03-01', end: '2027-03-31' };
async function setup(t, { fetcher, store, config = readConfig({ HUB_ADMIN_PASSWORD: password }) } = {}) {
  const server = createAppServer({ config, store, fetcher });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  let cookie = '';
  const call = async (path, body, options = {}) => {
    const response = await fetch(config.origin + '/api/' + path, { method: body === undefined ? 'GET' : 'POST',
      ...options, headers: { Origin: config.origin, 'Content-Type': 'application/json', Cookie: cookie, ...options.headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { response, status: response.status, data: await response.json() };
  };
  return { call, config, server, login: () => call('login', { password }) };
}

test('private API requires login, verifies origin, uses protected sessions and signs out', async t => {
  const { call, login, config } = await setup(t);
  assert.equal((await call('canvas')).status, 401);
  assert.equal((await call('canvas/sync', range)).status, 401);
  assert.equal((await call('login', { password }, { headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await call('login', { password: 'wrong' })).status, 401);
  const signedIn = await login();
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const info = await call('canvas');
  assert.equal(info.response.headers.get('cache-control'), 'no-store');
  assert.equal(info.status, 200);
  assert.equal(JSON.stringify(info.data).includes(config.token), false);
  assert.equal((await call('logout', {})).status, 200);
  assert.equal((await call('canvas')).status, 401);
});

test('demo sync, unit mapping, rescheduling and re-sync are persisted without duplicates', async t => {
  const { call, login } = await setup(t);
  await login();
  const original = await call('canvas/sync', range);
  assert.equal(original.status, 200);
  assert.equal(original.data.snapshot.modules.length, 9);
  assert.equal(original.data.snapshot.events.length, 1);
  const mapping = { kind: 'event', sourceId: '9001', courseId: 'ap-chemistry', unitId: 'unit-9' };
  assert.equal((await call('canvas/mapping', mapping)).status, 200);
  assert.equal((await call('canvas/mapping', { ...mapping, unitId: 'missing' })).status, 400);
  assert.equal((await call('canvas/mapping', { ...mapping, sourceId: 'missing' })).status, 400);
  const moved = await call('canvas/sync', { ...range, scenario: 'rescheduled' });
  assert.match(moved.data.snapshot.events[0].startAt, /^2027-03-22/);
  assert.deepEqual(moved.data.mappings, [mapping]);
  const repeat = await call('canvas/sync', { ...range, scenario: 'rescheduled' });
  assert.equal(repeat.data.snapshot.events.length, 1);
  assert.deepEqual(repeat.data.mappings, [mapping]);
  assert.equal((await call('canvas/mapping', { ...mapping, unitId: '' })).data.mappings.length, 0);
});

test('failed partial sync retains last success; renamed IDs retain mapping; deletion reconciles', async t => {
  let failing = false; let deleted = false; let renamed = false;
  const fixture = demoFetch();
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    if (failing && path.endsWith('/modules/109/items')) return Response.json({ secret: 'never-return-upstream-body' }, { status: 403 });
    if (deleted && path.endsWith('/calendar_events')) return Response.json([]);
    const response = await fixture(url, options);
    if (renamed && path.endsWith('/modules')) {
      const items = await response.json(); items[8].name = 'A renamed unit'; return Response.json(items);
    }
    return response;
  };
  const { call, login } = await setup(t, { fetcher });
  await login();
  const initial = (await call('canvas/sync', range)).data.snapshot;
  await call('canvas/mapping', { kind: 'module', sourceId: '109', courseId: 'ap-chemistry', unitId: 'unit-9' });
  failing = true;
  assert.equal((await call('canvas/sync', range)).status, 502);
  const after = (await call('canvas')).data;
  assert.deepEqual(after.snapshot, initial);
  assert.match(after.lastError, /permission/);
  assert.equal(JSON.stringify(after).includes('never-return-upstream-body'), false);
  failing = false; renamed = true; deleted = true;
  const updated = (await call('canvas/sync', range)).data;
  assert.equal(updated.snapshot.events.length, 0);
  assert.equal(updated.snapshot.modules[8].name, 'A renamed unit');
  assert.equal(updated.mappings[0].sourceId, '109');
  assert.equal(updated.lastError, null);
});

test('SQLite survives reopening and separates course/token identities', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'study-commons-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'test.sqlite');
  const first = createStore(path);
  first.write('course-a', { snapshot: { course: { name: 'Saved course' } }, mappings: [] });
  first.close();
  const second = createStore(path);
  try {
    assert.equal(second.read('course-a').snapshot.course.name, 'Saved course');
    assert.equal(second.read('course-b').snapshot, null);
  } finally { second.close(); }
  const base = { CANVAS_MODE: 'live', CANVAS_BASE_URL: 'https://canvas.example.test', CANVAS_COURSE_ID: '1', CANVAS_ACCESS_TOKEN: 'first-fixture-token' };
  assert.notEqual(readConfig(base).sourceKey, readConfig({ ...base, CANVAS_ACCESS_TOKEN: 'second-fixture-token' }).sourceKey);
});

test('Canvas pagination follows pages, retains filters, and only sends GET with a header token', async () => {
  const config = readConfig({}); const requests = [];
  const fixture = demoFetch();
  const client = createCanvasClient(config, async (input, options) => {
    const url = new URL(input); requests.push({ url, options });
    if (url.pathname.endsWith('/modules')) {
      return url.searchParams.has('page') ? Response.json([{ id: 109, name: 'Unit 9' }]) :
        Response.json([], { headers: { Link: `<${config.baseUrl}${url.pathname}?page=2>; rel="next"` } });
    }
    if (url.pathname.endsWith('/calendar_events') && !url.searchParams.has('page')) {
      return Response.json([], { headers: { Link: `<${config.baseUrl}${url.pathname}?page=2>; rel="next"` } });
    }
    return fixture(input, options);
  });
  const snapshot = await client.sync(range.start, range.end);
  assert.equal(snapshot.modules.length, 1);
  assert.equal(snapshot.events.length, 1);
  for (const { url, options } of requests) {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
    assert.equal(url.href.includes(config.token), false);
    if (url.pathname.endsWith('/calendar_events')) {
      assert.equal(url.searchParams.get('context_codes[]'), 'course_12345');
      assert.equal(url.searchParams.get('start_date'), range.start);
      assert.equal(url.searchParams.get('type'), 'event');
    }
  }
});

test('unsafe next-page links cannot receive credentials and loops stop', async () => {
  const config = readConfig({});
  for (const next of ['https://attacker.example/api/v1/courses/12345/modules?page=2', `${config.baseUrl}/api/v1/users?page=2`, `${config.baseUrl}/api/v1/courses/12345/modules?per_page=100`]) {
    const urls = [];
    const client = createCanvasClient(config, async (input, options) => {
      const url = new URL(input); urls.push(url.href);
      if (url.pathname.endsWith('/modules')) return Response.json([], { headers: { Link: `<${next}>; rel="next"` } });
      return demoFetch()(input, options);
    });
    await assert.rejects(() => client.sync(range.start, range.end), /unsafe|pagination/);
    assert.equal(urls.length, 2);
    assert.ok(urls.every(url => url.startsWith(config.baseUrl)));
  }
});

test('private fields, unpublished content, unrelated events and appointment reservations are omitted', async () => {
  const config = readConfig({}); const fixture = demoFetch();
  const client = createCanvasClient(config, async (input, options) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/modules')) return Response.json([{ id: 1, name: 'Unpublished', published: false }]);
    if (url.pathname.endsWith('/calendar_events')) return Response.json([
      { id: 1, context_code: 'course_12345', title: 'Lesson', start_at: '2027-03-15T16:00:00Z', description: 'private-html', user: { id: 99 } },
      { id: 2, context_code: 'user_99', title: 'Personal event' },
      { id: 3, context_code: 'course_12345', title: 'Hidden event', hidden: true },
      { id: 4, context_code: 'course_12345', title: 'Reservation', appointment_group_id: 42 },
    ]);
    return fixture(input, options);
  });
  const snapshot = await client.sync(range.start, range.end);
  assert.equal(snapshot.modules.length, 0);
  assert.equal(snapshot.events.length, 1);
  assert.equal(JSON.stringify(snapshot).includes('private-html'), false);
  assert.equal(snapshot.events[0].user, undefined);
});

test('configuration and date validation reject dangerous origins and impossible ranges', () => {
  for (const url of ['http://school.example', 'https://user:pass@school.example', 'https://school.example/courses/1']) {
    assert.throws(() => readConfig({ CANVAS_MODE: 'live', CANVAS_BASE_URL: url }));
  }
  assert.throws(() => readConfig({ HUB_ADMIN_PASSWORD: 'short' }));
  assert.throws(() => readConfig({ APP_ORIGIN: 'http://public.example' }));
  for (const values of [['2027-02-30', '2027-03-01'], ['2027-03-31', '2027-03-01'], ['2025-01-01', '2027-03-01'], [null, '2027-03-01']]) assert.throws(() => validateRange(...values));
  assert.match(formatCanvasDate('2027-03-15', 'America/Los_Angeles', true), /15/);
});

test('concurrent syncs cannot overwrite one another', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const reached = new Promise(resolve => { started = resolve; });
  const fixture = demoFetch();
  const { call, login } = await setup(t, { fetcher: async (input, options) => {
    if (new URL(input).pathname === '/api/v1/courses/12345') { started(); await gate; }
    return fixture(input, options);
  } });
  await login();
  const first = call('canvas/sync', range);
  await reached;
  try { assert.equal((await call('canvas/sync', range)).status, 409); }
  finally { release(); }
  assert.equal((await first).status, 200);
});

test('unconfigured login stays closed and repeated wrong passwords are limited', async t => {
  const closed = await setup(t, { config: readConfig({}) });
  assert.equal((await closed.call('login', { password })).status, 503);
  assert.equal((await closed.call('canvas')).status, 401);
  const { call } = await setup(t);
  for (let i = 0; i < 20; i++) assert.equal((await call('login', { password: 'wrong' })).status, 401);
  assert.equal((await call('login', { password: 'wrong' })).status, 429);
});
