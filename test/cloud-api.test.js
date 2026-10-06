import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readConfig } from '../lib/config.js';
import { createCloudApi } from '../lib/cloud-api.js';
import { accountDemoFetch, createCanvasClient } from '../lib/canvas.js';

const password = 'cloud-api-test-only-password';
const range = { start: '2027-03-01', end: '2027-03-31' };
const emptyState = () => ({ snapshot: null, mappings: [], lastAttempt: null, lastError: null });
const copy = value => structuredClone(value);

// Independent API instances share only these durable records. Atomic updates
// model the Blob adapter's CAS contract; no API instance holds a session/job map.
function sharedStore() {
  const records = new Map();
  let tail = Promise.resolve();
  const validateKey = key => assert.match(key, /^[A-Za-z0-9_-]{1,160}$/);
  async function read(key, fallback) {
    await tail;
    return copy(records.has(key) ? records.get(key) : fallback);
  }
  function update(key, fallback, mutator) {
    const operation = tail.then(async () => {
      const previous = copy(records.has(key) ? records.get(key) : fallback);
      const next = await mutator(copy(previous));
      if (next !== undefined) records.set(key, copy(next));
      return copy(next === undefined ? previous : next);
    });
    tail = operation.catch(() => {});
    return operation;
  }
  return {
    records,
    read(key) { validateKey(key); return read(`state:${key}`, emptyState()); },
    update(key, mutator) { validateKey(key); return update(`state:${key}`, emptyState(), mutator); },
    readRecord(key, fallback) { validateKey(key); return read(`record:${key}`, fallback); },
    updateRecord(key, fallback, mutator) { validateKey(key); return update(`record:${key}`, fallback, mutator); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function pilot({ fetcher = accountDemoFetch() } = {}) {
  const config = readConfig({ APP_ORIGIN: 'https://study.example.test', HUB_ADMIN_PASSWORD: password });
  const store = sharedStore();
  let time = Date.parse('2027-03-01T12:00:00Z');
  const instance = () => createCloudApi(config, store, { fetcher, now: () => time });
  async function call(api, path, { body, cookie = '', origin = config.origin, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    request.method = method;
    request.url = `/api/${path}`;
    request.headers = { cookie, origin, 'content-type': 'application/json', ...headers };
    const reply = { status: null, headers: {}, data: null };
    const response = {
      setHeader(key, value) { reply.headers[key.toLowerCase()] = value; },
      writeHead(status, values) { reply.status = status; for (const [key, value] of Object.entries(values)) response.setHeader(key, value); },
      end(value) { reply.data = JSON.parse(value); },
    };
    assert.equal(await api(request, response, `/api/${path.split('?')[0]}`), true);
    return reply;
  }
  const login = async () => {
    const response = await call(instance(), 'login', { body: { password } });
    assert.equal(response.status, 200);
    return response.headers['set-cookie'].split(';')[0];
  };
  async function start(cookie, body = range) {
    const response = await call(instance(), 'canvas/sync-all', { body, cookie });
    assert.equal(response.status, 202);
    return response.data.accountJob.id;
  }
  const step = (cookie, jobId, api = instance()) => call(api, 'canvas/sync-step', { body: { jobId }, cookie });
  async function finish(cookie, jobId) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await step(cookie, jobId);
      assert.equal(result.status, 200, JSON.stringify(result.data));
      if (!result.data.accountJob.running) return (await call(instance(), 'canvas', { cookie })).data;
    }
    assert.fail('The fictional two-course import should finish in four persisted steps.');
  }
  return { config, store, instance, call, login, start, step, finish, advance(ms) { time += ms; } };
}

test('sample grades ignore stored real grades, clear the old record and never call Canvas grade endpoints', async () => {
  let gradeRequests = 0;
  const fixture = accountDemoFetch();
  const hub = pilot({ fetcher: async (input, options) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/profile') || url.pathname.endsWith('/enrollments') || url.searchParams.get('include[]') === 'submission') { gradeRequests++; throw Error('Real grades must not be requested'); }
    return fixture(input, options);
  } });
  assert.equal((await hub.call(hub.instance(), 'canvas/grades', { body: { courseId: '12345' } })).status, 401);
  const cookie = await hub.login(); await hub.finish(cookie, await hub.start(cookie));
  await hub.store.update('grades-' + hub.config.accountKey, () => ({snapshot: {'12345': {currentScore: 99.123456, privateNote: 'do-not-expose'}}}));
  const before = (await hub.call(hub.instance(), 'canvas', {cookie})).data;
  assert.equal(before.gradeMode, 'demo'); assert.equal(before.grades['12345'].isDemo, true);
  assert.doesNotMatch(JSON.stringify(before), /99\.123456|do-not-expose/);
  assert.equal((await hub.call(hub.instance(), 'canvas/grades', { cookie, body: { courseId: '999' } })).status, 400);
  assert.equal((await hub.call(hub.instance(), 'canvas/grades', { cookie, origin: 'https://outsider.test', body: { courseId: '12345' } })).status, 403);
  const response = await hub.call(hub.instance(), 'canvas/grades', {cookie,body:{courseId:'12345'}});
  assert.equal(response.data.grades.isDemo, true);
  assert.equal((await hub.store.read('grades-' + hub.config.accountKey)).snapshot, null);
  const after = (await hub.call(hub.instance(), 'canvas', {cookie})).data;
  assert.deepEqual(after.account, before.account); assert.equal(gradeRequests,0);
  await hub.call(hub.instance(), 'logout', {cookie,body:{}});
  assert.equal((await hub.call(hub.instance(), 'canvas', {cookie})).status, 401);
});

test('cloud import resumes in fresh instances and publishes only a complete account snapshot', async () => {
  const fixture = accountDemoFetch();
  let requests = 0;
  const hub = pilot({ fetcher: (...args) => { requests += 1; return fixture(...args); } });
  const cookie = await hub.login();
  const id = await hub.start(cookie);
  assert.equal(requests, 0, 'job creation must not depend on unawaited background work');
  assert.equal((await hub.call(hub.instance(), 'canvas/sync-all', { cookie, body: range })).status, 409);
  assert.equal((await hub.step(cookie, id)).data.accountJob.total, 2);
  assert.equal((await hub.step(cookie, id)).data.accountJob.completed, 1);
  assert.equal((await hub.store.read(hub.config.accountKey)).snapshot, null);
  assert.equal((await hub.step(cookie, id)).data.accountJob.completed, 2);
  assert.equal((await hub.store.read(hub.config.accountKey)).snapshot, null, 'partial snapshots stay private until finalization');
  const view = await hub.finish(cookie, id);
  assert.equal(view.serverlessSync, true);
  assert.equal(view.account.snapshot.courses.length, 2);
  assert.equal(view.account.snapshot.warnings, 0);
  assert.equal(view.accountJob.running, false);
  assert.deepEqual(view.accountJob.range, range);
  assert.equal(view.accountJob.includeCompleted, true);
  assert.equal(view.account.importGeneration, 1);
  for (const hidden of ['lease', 'results', 'queue']) assert.equal(hidden in view.accountJob, false);
  assert.ok(!JSON.stringify(view).includes(hub.config.token));
});

test('concurrent steps across instances share a lease and cannot import the same course twice', async () => {
  const fixture = accountDemoFetch();
  const entered = deferred(); const release = deferred();
  let moduleRequests = 0;
  const hub = pilot({ fetcher: async (input, options) => {
    if (new URL(input).pathname === '/api/v1/courses/12345/modules') {
      moduleRequests += 1;
      entered.resolve();
      await release.promise;
    }
    return fixture(input, options);
  } });
  const cookie = await hub.login(); const id = await hub.start(cookie);
  await hub.step(cookie, id);
  const first = hub.step(cookie, id);
  await entered.promise;
  try {
    const second = await hub.step(cookie, id);
    assert.equal(second.status, 200);
    assert.equal(second.data.accountJob.completed, 0);
    assert.equal(moduleRequests, 1);
  } finally { release.resolve(); }
  assert.equal((await first).data.accountJob.completed, 1);
  const final = await hub.finish(cookie, id);
  assert.equal(moduleRequests, 1);
  assert.deepEqual(final.account.snapshot.courses.map(item => item.course.id), ['12345', '23456']);
});

test('mapping edits made while an import runs survive final publication', async () => {
  const hub = pilot(); const cookie = await hub.login();
  const old = await createCanvasClient(hub.config, accountDemoFetch()).syncAccount(range.start, range.end);
  await hub.store.update(hub.config.accountKey, saved => ({ ...saved, snapshot: old }));
  const id = await hub.start(cookie);
  await hub.step(cookie, id);
  await hub.step(cookie, id);
  await hub.step(cookie, id);
  const mapping = { courseId: '12345', eventId: '9001', moduleId: '109' };
  assert.equal((await hub.call(hub.instance(), 'canvas/course-mapping', { cookie, body: mapping })).status, 200);
  assert.equal((await hub.call(hub.instance(), 'canvas/course-mapping', { cookie, body: { ...mapping, courseId: '23456' } })).status, 400);
  const published = await hub.finish(cookie, id);
  assert.deepEqual(published.account.mappings, [mapping]);
  assert.notEqual(published.account.snapshot.startedAt, old.startedAt);
});

test('a failed course step preserves the old account and resumes from its saved checkpoint', async () => {
  const fixture = accountDemoFetch(); let denyOnce = true;
  const hub = pilot({ fetcher: (input, options) => {
    if (denyOnce && new URL(input).pathname === '/api/v1/courses/12345/modules') {
      denyOnce = false;
      return Response.json({ secret: 'do-not-reflect' }, { status: 401 });
    }
    return fixture(input, options);
  } });
  const old = await createCanvasClient(hub.config, fixture).syncAccount(range.start, range.end);
  await hub.store.update(hub.config.accountKey, saved => ({ ...saved, snapshot: old }));
  const cookie = await hub.login(); const id = await hub.start(cookie);
  await hub.step(cookie, id);
  const failed = await hub.step(cookie, id);
  assert.equal(failed.status, 502);
  assert.doesNotMatch(JSON.stringify(failed.data), /do-not-reflect/);
  const saved = (await hub.call(hub.instance(), 'canvas', { cookie })).data;
  assert.deepEqual(saved.account.snapshot, old);
  assert.equal(saved.accountJob.completed, 0);
  assert.equal(saved.accountJob.running, true);
  assert.match(saved.accountJob.error, /access token/);
  assert.equal((await hub.step(cookie, id)).data.accountJob.completed, 1);
  const resumed = await hub.finish(cookie, id);
  assert.equal(resumed.account.snapshot.courses.length, 2);
  assert.equal(resumed.accountJob.error, null);
  assert.equal(resumed.account.lastError, null);
});

test('an expired worker cannot overwrite a newer published import or add a stale failure', async t => {
  for (const failLate of [false, true]) {
    await t.test(failLate ? 'late failure' : 'late publication', async () => {
      const hub = pilot(); const cookie = await hub.login(); const firstId = await hub.start(cookie);
      await hub.step(cookie, firstId); await hub.step(cookie, firstId); await hub.step(cookie, firstId);
      const entered = deferred(); const release = deferred();
      const atomicUpdate = hub.store.update.bind(hub.store);
      let pauseNextPublish = true;
      hub.store.update = async (key, mutator) => {
        if (key === hub.config.accountKey && pauseNextPublish) {
          pauseNextPublish = false; entered.resolve(); await release.promise;
          if (failLate) throw new Error('provider secret must not escape');
        }
        return atomicUpdate(key, mutator);
      };
      const oldWorker = hub.step(cookie, firstId);
      await entered.promise;
      let newer;
      try {
        hub.advance(250001);
        await hub.finish(cookie, firstId);
        const secondId = await hub.start(cookie, { ...range, includeCompleted: false });
        newer = await hub.finish(cookie, secondId);
        assert.equal(newer.account.importGeneration, 2);
        assert.deepEqual(newer.account.snapshot.courses.map(item => item.course.id), ['12345']);
      } finally { release.resolve(); }
      const late = await oldWorker;
      assert.equal(late.status, failLate ? 502 : 200);
      assert.doesNotMatch(JSON.stringify(late.data), /provider secret/);
      const after = (await hub.call(hub.instance(), 'canvas', { cookie })).data;
      assert.deepEqual(after.account, newer.account);
      assert.deepEqual(after.accountJob, newer.accountJob);
    });
  }
});

test('authentication and same-origin checks protect persisted courses and sync checkpoints', async () => {
  let requests = 0;
  const fixture = accountDemoFetch();
  const hub = pilot({ fetcher: (...args) => { requests += 1; return fixture(...args); } });
  for (const [path, body] of [['canvas', undefined], ['canvas/sync-all', range], ['canvas/sync-step', { jobId: 'a'.repeat(16) }], ['canvas/course-mapping', {}]]) {
    const result = await hub.call(hub.instance(), path, { body });
    assert.equal(result.status, 401);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  const cookie = await hub.login();
  const id = await hub.start(cookie);
  assert.equal((await hub.call(hub.instance(), 'canvas/sync-step', { cookie, origin: 'https://elsewhere.example', body: { jobId: id } })).status, 403);
  assert.equal((await hub.step(cookie, '../../private')).status, 400);
  assert.equal((await hub.step(cookie, 'f'.repeat(16))).status, 409);
  assert.equal(requests, 0);
  await hub.finish(cookie, id);
  const snapshot = await hub.store.read(hub.config.accountKey);
  assert.equal(snapshot.snapshot.courses.length, 2);
  assert.equal((await hub.call(hub.instance(), 'logout', { cookie, body: {} })).status, 200);
  assert.equal((await hub.call(hub.instance(), 'canvas', { cookie })).status, 401);
  assert.deepEqual(await hub.store.read(hub.config.accountKey), snapshot, 'logging out revokes access without deleting the import');
});
