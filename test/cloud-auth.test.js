import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudAuth } from '../lib/cloud-auth.js';

// Serializes atomic updates while separate auth instances share only durable records.
function sharedStore() {
  const records = new Map();
  let tail = Promise.resolve();
  const copy = value => structuredClone(value);
  const validateKey = key => assert.match(key, /^[A-Za-z0-9_-]{1,160}$/, 'keys must satisfy the Blob store contract');
  return {
    records,
    async readRecord(key, fallback) {
      validateKey(key);
      await tail;
      return copy(records.has(key) ? records.get(key) : fallback);
    },
    updateRecord(key, fallback, mutator) {
      validateKey(key);
      const operation = tail.then(() => {
        const previous = copy(records.has(key) ? records.get(key) : fallback);
        const next = mutator(previous);
        if (next !== undefined) records.set(key, copy(next));
        return copy(next === undefined ? previous : next);
      });
      tail = operation.catch(() => {});
      return operation;
    },
  };
}

const config = { password: 'private-pilot-test-password', accountKey: 'account-test', origin: 'https://study.example.test' };
const tokenFrom = cookie => cookie.split(';')[0].slice('hub_session='.length);
const request = token => ({ headers: { cookie: `unrelated=value; hub_session=${token}` } });

test('a session survives a new instance, has private cookie flags, and is revoked everywhere on logout', async () => {
  const store = sharedStore();
  const first = createCloudAuth(config, store);
  const second = createCloudAuth(config, store);
  const { cookie } = await first.login(config.password);
  const token = tokenFrom(cookie);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(cookie, `hub_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure`);
  assert.equal(await second.authenticate(request(token)), token);
  const serialized = JSON.stringify([...store.records]);
  assert.ok(!serialized.includes(config.password));
  assert.ok(!serialized.includes(token));
  assert.ok(!serialized.includes(config.accountKey));
  assert.deepEqual(Object.keys([...store.records.values()].find(value => value.binding)).sort(), ['binding', 'expires']);
  assert.equal((await second.logout(token)).cookie, 'hub_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure');
  assert.equal(await first.authenticate(request(token)), null);
});

test('sessions expire at eight hours and credential or account changes invalidate them', async () => {
  const store = sharedStore();
  let time = 1_000_000;
  const auth = createCloudAuth(config, store, { now: () => time });
  const token = tokenFrom((await auth.login(config.password)).cookie);
  for (const changed of [{ ...config, password: 'a-different-private-password' }, { ...config, accountKey: 'different-account' }]) {
    assert.equal(await createCloudAuth(changed, store, { now: () => time }).authenticate(request(token)), null);
  }
  time += 8 * 3600 * 1000 - 1;
  assert.equal(await auth.authenticate(request(token)), token);
  time += 1;
  assert.equal(await auth.authenticate(request(token)), null);
});

test('logging in again revokes the supplied prior session and rejects forged or ambiguous cookies', async () => {
  const store = sharedStore();
  const auth = createCloudAuth({ ...config, origin: 'http://localhost:3000' }, store);
  const oldToken = tokenFrom((await auth.login(config.password)).cookie);
  const next = await auth.login(config.password, oldToken);
  const token = tokenFrom(next.cookie);
  assert.ok(!next.cookie.includes('; Secure'));
  assert.notEqual(token, oldToken);
  assert.equal(await auth.authenticate(request(oldToken)), null);
  assert.equal(await auth.authenticate(request(token)), token);
  assert.equal(await auth.authenticate(request('a'.repeat(64))), null);
  assert.equal(await auth.authenticate(request('../../private')), null);
  assert.equal(await auth.authenticate({ headers: { cookie: `hub_session=${token}; hub_session=${token}` } }), null);
  assert.equal(await auth.authenticate({ headers: {} }), null);
});

test('concurrent attempts share a persistent twenty-attempt limit and recover after five minutes', async () => {
  const store = sharedStore();
  let time = 2_000_000;
  const first = createCloudAuth(config, store, { now: () => time });
  const second = createCloudAuth(config, store, { now: () => time });
  const attempts = await Promise.allSettled(Array.from({ length: 30 }, (_, index) =>
    (index % 2 ? first : second).login('incorrect-password')));
  assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason.status === 401).length, 20);
  assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason.status === 429).length, 10);
  assert.equal(store.records.get('auth-login-attempts').attempts.length, 20);
  await assert.rejects(createCloudAuth(config, store, { now: () => time }).login(config.password), { status: 429 });
  time += 5 * 60 * 1000;
  const token = tokenFrom((await second.login(config.password)).cookie);
  assert.equal(await first.authenticate(request(token)), token);
});

test('missing credentials and storage errors fail closed without leaking provider details', async () => {
  const store = sharedStore();
  const live = createCloudAuth(config, store);
  const token = tokenFrom((await live.login(config.password)).cookie);
  const disabled = createCloudAuth({ ...config, password: '' }, store);
  assert.equal(await disabled.authenticate(request(token)), null);
  await assert.rejects(disabled.login(''), { status: 503 });
  await assert.rejects(live.login({ password: config.password }), { status: 401 });
  const failing = createCloudAuth(config, {
    async readRecord() { throw new Error('provider secret detail'); },
    async updateRecord() { throw new Error('provider secret detail'); },
  });
  for (const operation of [() => failing.login(config.password), () => failing.authenticate(request(token)), () => failing.logout(token)]) {
    await assert.rejects(operation, error => error.status === 503 && !error.message.includes('provider secret detail'));
  }
});
