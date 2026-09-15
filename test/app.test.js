import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.js';
import { courses, school } from '../public/data.js';
import { createInitialState, loadState, saveState, safeUrl, parseRoute, escapeHTML } from '../public/state.js';

test('serves public assets while protecting project files and rejecting mutations', async t => {
  const server = createAppServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/app.js', '/styles.css', '/data.js', '/state.js', '/health']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 0, path);
  }
  for (const path of ['/server.js', '/package.json', '/.env', '/.replit', '/%2e%2e/server.js']) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
  const head = await fetch(origin, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.match(head.headers.get('content-type'), /^text\/html/);
  assert.match(head.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(origin, { method: 'POST', body: 'not-an-api' })).status, 405);
});

test('local course selections, replies and pending suggestions survive a save/load cycle', () => {
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const state = createInitialState(courses, school);
  state.joined = ['algebra-2'];
  state.questions['algebra-2'].push({ id: 'my-question', title: 'Example?', body: 'A question', unitId: 'functions', author: 'You', mine: true, answered: true, replies: [{ author: 'You', body: 'A reply' }] });
  state.suggestions.push({ id: 'suggestion', courseId: 'algebra-2', title: 'Notes', source: 'Me', url: 'https://example.org' });
  assert.equal(saveState(storage, school.storageKey, state), true);
  assert.deepEqual(loadState(storage, courses, school), state);
  assert.equal(courses[2].questions.length, 0, 'seed data must not be mutated');
});

test('corrupt or inaccessible storage falls back without breaking the app', () => {
  const fresh = createInitialState(courses, school);
  assert.deepEqual(loadState({ getItem: () => '{bad-json' }, courses, school), fresh);
  assert.deepEqual(loadState({ getItem: () => { throw Error('blocked'); } }, courses, school), fresh);
  assert.equal(saveState(null, school.storageKey, fresh), false);
  assert.equal(saveState({ setItem: () => { throw Error('quota'); } }, school.storageKey, fresh), false);
});

test('removed courses and stale unit references are normalized', () => {
  const saved = createInitialState(courses, school);
  saved.joined = ['missing-course', 'ap-chemistry', 'ap-chemistry'];
  saved.questions['ap-chemistry'][0].unitId = 'removed-unit';
  saved.questions['ap-chemistry'][0].replies.push(null);
  const normalized = loadState({ getItem: () => JSON.stringify(saved) }, courses, school);
  assert.deepEqual(normalized.joined, ['ap-chemistry']);
  assert.equal(normalized.questions['ap-chemistry'][0].unitId, '');
  assert.equal(normalized.questions['ap-chemistry'][0].replies.length, 2);
});

test('root URLs and course deep links resolve to the correct views', () => {
  assert.equal(parseRoute('', courses).page, 'dashboard');
  assert.equal(parseRoute('#', courses).page, 'dashboard');
  const route = parseRoute('#course/ap-chemistry/discussions', courses);
  assert.equal(route.course.id, 'ap-chemistry');
  assert.equal(route.section, 'discussions');
  assert.equal(parseRoute('#course/missing/resources', courses).course, undefined);
});

test('resource links cannot execute scripts and user content is escaped', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'not a URL']) assert.equal(safeUrl(input), null);
  assert.equal(safeUrl('https://example.org/notes'), 'https://example.org/notes');
  assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});
