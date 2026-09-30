import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasUi } from '../public/canvas.js';

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } });
const signedIn = { authenticated: true, loginConfigured: true };
const flush = () => new Promise(resolve => setImmediate(resolve));

function account({ job = { running: false }, title = 'Saved chemistry course' } = {}) {
  const record = {
    course: { id: '3562', name: title, code: 'CHEM', state: 'available', term: 'Test term', timeZone: 'UTC', url: 'https://canvas.example.test/courses/3562', syllabusUrl: 'https://canvas.example.test/courses/3562/assignments/syllabus' },
    modules: [], assignments: [], pages: [], files: [], announcements: [], discussions: [], quizzes: [], events: [], collections: {}, warnings: [],
    range: { start: '2026-09-01', end: '2027-08-01' }, syncedAt: '2026-09-01T12:00:00Z',
  };
  return { mode: 'live', serverlessSync: true, baseUrl: 'https://canvas.example.test', accountReady: true, accountMissing: [],
    account: { snapshot: { courses: [record], range: record.range, warnings: 0, completedAt: record.syncedAt }, mappings: [], lastError: null }, accountJob: job };
}

function harness(t) {
  const listeners = { document: new Map(), window: new Map() };
  const timers = new Map(); const expected = []; const requests = []; const failures = []; const notices = [];
  let timerId = 0; let renders = 0;
  function replace(name, value) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
  }
  for (const surface of ['document', 'window']) replace(surface, { addEventListener(type, handler) { listeners[surface].set(type, handler); } });
  replace('location', { hash: '#canvas' });
  replace('FormData', class { constructor(form) { return new Map(Object.entries(form.values)); } });
  replace('setTimeout', (callback, delay) => { assert.equal(delay, 1500); timers.set(++timerId, callback); return timerId; });
  replace('clearTimeout', id => timers.delete(id));
  replace('fetch', async (url, options) => {
    requests.push({ url, ...options });
    const next = expected.shift();
    try {
      assert.ok(next, `Unexpected request: ${options.method} ${url}`);
      assert.equal(url, next.url);
      assert.equal(options.method, next.method);
      if (next.body !== undefined) assert.deepEqual(JSON.parse(options.body), next.body);
    } catch (error) { failures.push(error.message); throw error; }
    return await next.result;
  });
  t.after(() => { assert.deepEqual(failures, []); assert.equal(expected.length, 0, 'all expected requests were made'); });
  const ui = createCanvasUi({ courses: [], onChange() { renders++; }, notice(value) { notices.push(value); } });
  return {
    ui, requests, notices, timers,
    get renders() { return renders; },
    expect(url, result, { method = 'GET', body } = {}) { expected.push({ url: `/api/${url}`, result, method, body }); },
    async load(data) { this.expect('session', response(signedIn)); this.expect('canvas', response(data)); await ui.refresh(); },
    runTimer() { assert.equal(timers.size, 1, 'exactly one polling timer is scheduled'); const [id, callback] = timers.entries().next().value; timers.delete(id); return callback(); },
    click(action) { return listeners.document.get('click')({ target: { closest() { return { dataset: { canvasAction: action } }; } } }); },
    submit(action, values) { return listeners.document.get('submit')({ target: { dataset: { canvasForm: action }, values }, preventDefault() {} }); },
    pageshow() { return listeners.window.get('pageshow')({ persisted: true }); },
  };
}

test('starting a cloud import polls steps and reloads saved courses only when the job finishes', async t => {
  const h = harness(t);
  await h.load(account());
  const job = { id: 'job-new', running: true, completed: 0, total: 2 };
  h.expect('canvas/sync-all', response(account({ job })), { method: 'POST', body: { start: '2026-09-01', end: '2027-08-01', includeCompleted: false } });
  await h.submit('sync-all', { start: '2026-09-01', end: '2027-08-01', scope: 'available' });
  assert.match(h.ui.view(), /Personal pilot/);
  assert.match(h.ui.view(), /Keep Study Commons open while importing/);
  assert.match(h.ui.dashboardView(), /Saved chemistry course/);
  h.expect('canvas/sync-step', response({ accountJob: { ...job, completed: 1 } }), { method: 'POST', body: { jobId: 'job-new' } });
  await h.runTimer();
  assert.match(h.ui.view(), /1 of 2 courses processed/);
  assert.equal(h.requests.filter(request => request.url === '/api/canvas').length, 1);
  h.expect('canvas/sync-step', response({ accountJob: { ...job, completed: 2, running: false } }), { method: 'POST', body: { jobId: 'job-new' } });
  h.expect('canvas', response(account({ title: 'Refreshed chemistry course' })));
  await h.runTimer();
  assert.match(h.ui.dashboardView(), /Refreshed chemistry course/);
  assert.doesNotMatch(h.ui.dashboardView(), /Saved chemistry course/);
  assert.equal(h.timers.size, 0);
});

test('a failed cloud step pauses without losing courses and Resume reads the durable job before continuing', async t => {
  const h = harness(t);
  const job = { id: 'job-before-failure', running: true, completed: 3, total: 5 };
  await h.load(account({ job }));
  h.expect('canvas/sync-step', response({ error: 'Temporary storage failure.' }, 503), { method: 'POST', body: { jobId: job.id } });
  await h.runTimer();
  assert.equal(h.timers.size, 0);
  assert.match(h.ui.view(), /Import paused: Temporary storage failure/);
  assert.match(h.ui.view(), /Resume import/);
  assert.match(h.ui.dashboardView(), /Saved chemistry course/);
  const resumed = { ...job, id: 'job-restored-from-server', completed: 4 };
  h.expect('session', response(signedIn));
  h.expect('canvas', response(account({ job: resumed })));
  await h.click('resume');
  assert.doesNotMatch(h.ui.view(), /Import paused|Resume import/);
  assert.match(h.ui.view(), /4 of 5 courses processed/);
  h.expect('canvas/sync-step', response({ accountJob: { ...resumed, completed: 5, running: false } }), { method: 'POST', body: { jobId: resumed.id } });
  h.expect('canvas', response(account({ title: 'Resumed saved course' })));
  await h.runTimer();
  assert.match(h.ui.dashboardView(), /Resumed saved course/);
  assert.equal(h.timers.size, 0);
});

test('restoring a page reloads durable progress and supersedes its previously scheduled poll', async t => {
  const h = harness(t);
  await h.load(account({ job: { id: 'old-job', running: true, completed: 0, total: 3 } }));
  h.expect('session', response(signedIn));
  h.expect('canvas', response(account({ job: { id: 'restored-job', running: true, completed: 2, total: 3 } })));
  h.pageshow();
  await flush();
  assert.equal(h.timers.size, 1);
  h.expect('canvas/sync-step', response({ accountJob: { id: 'restored-job', running: false, completed: 3, total: 3 } }), { method: 'POST', body: { jobId: 'restored-job' } });
  h.expect('canvas', response(account()));
  await h.runTimer();
  assert.equal(h.timers.size, 0);
});

test('a late cloud step response cannot restart polling or restore private courses after logout', async t => {
  const h = harness(t);
  const job = { id: 'late-step-job', running: true, completed: 0, total: 1 };
  await h.load(account({ job }));
  const pending = Promise.withResolvers();
  h.expect('canvas/sync-step', pending.promise, { method: 'POST', body: { jobId: job.id } });
  const poll = h.runTimer();
  h.expect('logout', response({ authenticated: false }), { method: 'POST', body: {} });
  await h.click('logout');
  const rendersAfterLogout = h.renders;
  pending.resolve(response({ accountJob: { ...job, running: false, completed: 1 } }));
  await poll;
  assert.equal(h.renders, rendersAfterLogout);
  assert.equal(h.ui.hasAccount(), false);
  assert.equal(h.ui.dashboardView(), '');
  assert.equal(h.ui.navView(), '');
  assert.match(h.ui.view(), /Personal pilot sign-in/);
  assert.equal(h.timers.size, 0);
});

test('a late completion snapshot cannot restore private courses after logout', async t => {
  const h = harness(t);
  const job = { id: 'late-snapshot-job', running: true, completed: 0, total: 1 };
  await h.load(account({ job }));
  const pending = Promise.withResolvers();
  h.expect('canvas/sync-step', response({ accountJob: { ...job, running: false, completed: 1 } }), { method: 'POST' });
  h.expect('canvas', pending.promise);
  const poll = h.runTimer();
  await flush();
  h.expect('logout', response({ authenticated: false }), { method: 'POST' });
  await h.click('logout');
  pending.resolve(response(account({ title: 'Late private course' })));
  await poll;
  assert.equal(h.ui.hasAccount(), false);
  assert.equal(h.ui.dashboardView(), '');
  assert.equal(h.timers.size, 0);
});

test('a page restore begun during logout cannot reauthenticate the UI after logout completes', async t => {
  const h = harness(t);
  await h.load(account());
  const logout = Promise.withResolvers();
  const privateData = Promise.withResolvers();
  h.expect('logout', logout.promise, { method: 'POST' });
  const signingOut = h.click('logout');
  h.expect('session', response(signedIn));
  h.expect('canvas', privateData.promise);
  h.pageshow();
  await flush();
  logout.resolve(response({ authenticated: false }));
  await signingOut;
  privateData.resolve(response(account({ title: 'Private stale restored course' })));
  await flush();
  assert.equal(h.ui.hasAccount(), false);
  assert.equal(h.ui.dashboardView(), '');
  assert.match(h.ui.view(), /Personal pilot sign-in/);
  assert.equal(h.timers.size, 0);
});
