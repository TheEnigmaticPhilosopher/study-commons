import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readConfig } from '../lib/config.js';
import { createStore } from '../lib/store.js';
import { createCanvasClient, accountDemoFetch } from '../lib/canvas.js';
import { createAppServer } from '../server.js';
import { saltyCatalog } from '../lib/salty.js';

const connectorKey = 'fictional-connector-key-for-test-only-12345';
async function setup(t) {
  const config = readConfig({ HUB_ADMIN_PASSWORD: 'fictional-private-password', SALTY_CONNECTOR_TOKEN: connectorKey, SALTY_COURSE_IDS: '12345,23456' });
  const snapshot = await createCanvasClient(config, accountDemoFetch()).syncAccount('2027-03-01', '2027-03-31');
  const store = createStore();
  const saved = { snapshot, mappings: [{ courseId: '12345', eventId: '9001', moduleId: '109' }], lastAttempt: snapshot.startedAt, lastError: null };
  store.write(config.accountKey, saved);
  const server = createAppServer({ config, store }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (query = '?course_id=12345', options = {}) => fetch(`${config.origin}/api/integrations/salty/courses${query}`, { headers: { Authorization: `Bearer ${connectorKey}` }, ...options });
  return { config, snapshot, saved, store, request };
}
test('SALTY feed requires its own key and explicitly allowed course IDs', async t => {
  const { request, config } = await setup(t);
  assert.equal((await request('', { headers: {} })).status, 401);
  assert.equal((await request('', { headers: { Authorization: `Bearer ${config.token}` } })).status, 401);
  assert.equal((await request('')).status, 400);
  assert.equal((await request('?course_id=12345&course_id=99999')).status, 403);
  assert.equal((await request('?course_id=not-a-number')).status, 400);
  assert.equal((await request('?course_id=12345&actor=admin')).status, 400);
  assert.equal((await request('?course_id=12345', { method: 'POST', headers: { Origin: config.origin, Authorization: `Bearer ${connectorKey}` } })).status, 405);
  assert.equal((await fetch(`${config.origin}/api/canvas`, { headers: { Authorization: `Bearer ${connectorKey}` } })).status, 401);
  assert.equal((await fetch(`${config.origin}/api/canvas/sync-all`, { method: 'POST', headers: { Origin: config.origin, Authorization: `Bearer ${connectorKey}` } })).status, 401);
});
test('SALTY feed returns only requested resources with stable references, teaching links and no secrets', async t => {
  const { request, config } = await setup(t);
  const response = await request(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const feed = await response.json(); const course = feed.courses[0];
  assert.equal(feed.schemaVersion, 1); assert.equal(feed.sync.status, 'complete'); assert.equal(feed.courses.length, 1);
  assert.deepEqual(feed.scope, ['12345']); assert.equal(course.id, '12345');
  assert.equal(course.hubUrl, `${config.origin}/#canvas-course/12345/modules`);
  assert.equal(course.files[0].url, 'https://canvas.example.test/courses/12345/files/81');
  assert.deepEqual(course.teachingLinks, [{ moduleId: '109', eventId: '9001' }]);
  const both = await (await request('?course_id=12345&course_id=23456')).json();
  assert.notEqual(both.courses[0].modules[8].sourceRef.key, both.courses[1].modules[0].sourceRef.key);
  assert.deepEqual((await (await request()).json()).courses[0].sourceRef, course.sourceRef);
  for (const secret of [config.token, config.password, connectorKey]) assert.equal(JSON.stringify(feed).includes(secret), false);
});
test('SALTY feed preserves partial and failed states, omits stale teaching mappings and reports unsynced scope', async t => {
  const { config, saved } = await setup(t);
  saved.snapshot.courses[0].warnings.push('files: temporary error');
  saved.snapshot.courses[0].collections.files.status = 'failed';
  saved.snapshot.courses[0].events = [];
  saved.snapshot.courses[0].collections.events.count = 0;
  let feed = saltyCatalog(config, saved, ['12345']);
  assert.equal(feed.sync.status, 'partial'); assert.equal(feed.courses[0].files.length, 1); assert.deepEqual(feed.courses[0].teachingLinks, []);
  saved.lastError = 'Canvas rejected the access token.';
  assert.equal(saltyCatalog(config, saved, ['12345']).sync.status, 'failed');
  assert.equal(saltyCatalog(config, saved, ['12345'], true).sync.status, 'running');
  feed = saltyCatalog(config, { snapshot: null, mappings: [], lastAttempt: null, lastError: null }, ['12345']);
  assert.equal(feed.sync.status, 'not_synced'); assert.deepEqual(feed.unavailableCourseIds, ['12345']);
});
test('SALTY connector is disabled by default and rejects reused credentials or missing scope', () => {
  assert.equal(readConfig({}).saltyToken, '');
  assert.throws(() => readConfig({ SALTY_CONNECTOR_TOKEN: connectorKey }), /SALTY_COURSE_IDS/);
  assert.throws(() => readConfig({ HUB_ADMIN_PASSWORD: connectorKey, SALTY_CONNECTOR_TOKEN: connectorKey, SALTY_COURSE_IDS: '12345' }), /separate secret/);
  assert.throws(() => readConfig({ SALTY_CONNECTOR_TOKEN: connectorKey, SALTY_COURSE_IDS: 'all' }), /numeric/);
});
