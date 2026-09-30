import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobStoreError, createBlobStore } from '../lib/blob-store.js';

class BlobError extends Error {
  constructor(message) { super(`Vercel Blob: ${message}`); }
}
class BlobPreconditionFailedError extends BlobError {}

function fakeSdk() {
  const values = new Map();
  const calls = [];
  let revision = 0;
  const api = {
    BlobError, BlobPreconditionFailedError,
    async get(path, options) {
      calls.push({ method: 'get', path, options });
      const record = values.get(path);
      if (!record) return null;
      return {
        statusCode: 200, stream: new Response(record.body).body,
        blob: { etag: record.etag, size: Buffer.byteLength(record.body) },
      };
    },
    async put(path, body, options) {
      calls.push({ method: 'put', path, options, body });
      const previous = values.get(path);
      if (options.ifMatch && previous?.etag !== options.ifMatch) throw new BlobPreconditionFailedError('ETag mismatch.');
      if (!options.allowOverwrite && previous) throw new BlobError('This blob already exists, use allowOverwrite.');
      const etag = `"revision-${++revision}"`;
      values.set(path, { body, etag });
      return { pathname: path, etag };
    },
  };
  return { api, values, calls };
}

test('missing state returns independent defaults and private reads always bypass cache', async () => {
  const fake = fakeSdk();
  const store = createBlobStore({ sdk: fake.api, storeId: 'store_fixture' });
  const result = await store.read('a'.repeat(64));
  assert.deepEqual(result, { snapshot: null, mappings: [], lastAttempt: null, lastError: null });
  result.mappings.push('local change');
  assert.deepEqual((await store.read('a'.repeat(64))).mappings, []);
  for (const call of fake.calls) {
    assert.equal(call.options.access, 'private');
    assert.equal(call.options.useCache, false);
    assert.equal(call.options.headers['Accept-Encoding'], 'identity');
    assert.equal(call.options.storeId, 'store_fixture');
    assert.equal(call.options.token, undefined);
    assert.equal(call.options.oidcToken, undefined);
    assert.equal(call.path, `study-commons/v1/states/${'a'.repeat(64)}.json`);
  }
});

test('large compressed responses cannot replace the strong ETag used for conditional writes', async () => {
  const fake = fakeSdk();
  const rawGet = fake.api.get;
  fake.api.get = async (path, options) => {
    const result = await rawGet(path, options);
    if (result && result.blob.size > 1024 && options.headers?.['Accept-Encoding'] !== 'identity') {
      result.blob.etag = `W/${result.blob.etag}`;
    }
    return result;
  };
  const store = createBlobStore({ sdk: fake.api });
  await store.updateRecord('large-job', null, () => ({ queue: 'course metadata'.repeat(1000), completed: 0 }));
  const saved = await store.updateRecord('large-job', null, value => ({ ...value, completed: 1 }));
  assert.equal(saved.completed, 1);
  assert.equal((await store.readRecord('large-job', null)).completed, 1);
});

test('creation and replacement use deterministic private paths and conditional writes', async () => {
  const fake = fakeSdk();
  const store = createBlobStore({ sdk: fake.api, token: 'synthetic-test-secret' });
  const initial = await store.update('account', state => ({ ...state, snapshot: { courses: [1] } }));
  const updated = await store.update('account', state => ({ ...state, mappings: [{ courseId: '1' }] }));
  assert.deepEqual(updated.snapshot, initial.snapshot);
  assert.deepEqual(await store.read('account'), updated);
  const writes = fake.calls.filter(call => call.method === 'put');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].options.allowOverwrite, false);
  assert.equal(writes[0].options.ifMatch, undefined);
  assert.equal(writes[1].options.ifMatch, '"revision-1"');
  assert.equal(writes[1].options.allowOverwrite, true);
  for (const call of fake.calls) {
    assert.equal(call.options.token, 'synthetic-test-secret');
    assert.equal(call.options.access, 'private');
  }
  for (const call of writes) {
    assert.equal(call.options.addRandomSuffix, false);
    assert.equal(call.options.contentType, 'application/json; charset=utf-8');
  }
});

test('simultaneous creation across instances retries without losing either mapping', async () => {
  const fake = fakeSdk();
  const first = createBlobStore({ sdk: fake.api });
  const second = createBlobStore({ sdk: fake.api });
  const results = await Promise.all([
    first.update('account', current => ({ ...current, mappings: [...current.mappings, 'first'] })),
    second.update('account', current => ({ ...current, mappings: [...current.mappings, 'second'] })),
  ]);
  assert.deepEqual((await first.read('account')).mappings.sort(), ['first', 'second']);
  assert.equal(fake.calls.filter(call => call.method === 'put').length, 3);
  assert.ok(results.some(result => result.mappings.length === 2));
});

test('stale updates rerun their mutator with fresh state and return the committed value', async () => {
  const fake = fakeSdk();
  const first = createBlobStore({ sdk: fake.api });
  const second = createBlobStore({ sdk: fake.api });
  await first.updateRecord('auth', { attempts: 0 }, current => current);
  const results = await Promise.all([
    first.updateRecord('auth', {}, current => ({ attempts: current.attempts + 1 })),
    second.updateRecord('auth', {}, current => ({ attempts: current.attempts + 1 })),
  ]);
  assert.deepEqual(results.map(result => result.attempts).sort(), [1, 2]);
  assert.deepEqual(await first.readRecord('auth', {}), { attempts: 2 });
  assert.equal(fake.calls.filter(call => call.method === 'put').length, 4);
});

test('record namespace isolates authentication and jobs from Canvas state', async () => {
  const fake = fakeSdk();
  const store = createBlobStore({ sdk: fake.api });
  await store.write('same', { snapshot: { courses: [1] } });
  await store.updateRecord('same', null, () => ({ running: true }));
  assert.deepEqual(await store.read('same'), { snapshot: { courses: [1] } });
  assert.deepEqual(await store.readRecord('same', null), { running: true });
  await store.updateRecord('same', null, () => null);
  assert.equal(await store.readRecord('same', { fallback: true }), null);
});

test('undefined means no write, even when a mutator changes its copy', async () => {
  const fake = fakeSdk();
  const store = createBlobStore({ sdk: fake.api });
  const result = await store.updateRecord('auth', { attempts: [] }, current => { current.attempts.push(1); });
  assert.deepEqual(result, { attempts: [] });
  assert.equal(fake.calls.filter(call => call.method === 'put').length, 0);
});

test('conflict retry exhaustion leaves existing data intact and reports a safe busy error', async () => {
  const fake = fakeSdk();
  const store = createBlobStore({ sdk: fake.api, maxAttempts: 3 });
  await store.write('account', { saved: true });
  let attempts = 0;
  fake.api.put = async () => { attempts += 1; throw new BlobPreconditionFailedError('secret detail'); };
  await assert.rejects(store.update('account', () => ({ saved: false })), error => {
    assert.equal(error.code, 'STORE_BUSY');
    assert.doesNotMatch(String(error), /secret detail/);
    return true;
  });
  assert.equal(attempts, 3);
  assert.deepEqual(await store.read('account'), { saved: true });
});

test('SDK read and write errors are masked instead of becoming empty or successful state', async () => {
  const fake = fakeSdk();
  const store = createBlobStore({ sdk: fake.api });
  fake.api.get = async () => { throw new Error('https://secret-host/?token=do-not-expose'); };
  await assert.rejects(store.read('account'), error => {
    assert.ok(error instanceof BlobStoreError);
    assert.equal(error.code, 'STORE_READ_FAILED');
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(String(error), /secret-host|do-not-expose/);
    return true;
  });
  fake.api.get = async () => null;
  fake.api.put = async () => { throw new BlobError('token=do-not-expose'); };
  await assert.rejects(store.update('account', state => state), error => {
    assert.equal(error.code, 'STORE_WRITE_FAILED');
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(String(error), /do-not-expose/);
    return true;
  });
});

test('corrupt data, missing ETags, and incomplete reads cannot overwrite saved state', async () => {
  for (const result of [
    { statusCode: 200, stream: new Response('{broken').body, blob: { etag: '"valid"' } },
    { statusCode: 200, stream: new Response('{}').body, blob: { etag: '' } },
    { statusCode: 304, stream: null, blob: { etag: '"valid"' } },
  ]) {
    let writes = 0;
    const store = createBlobStore({ sdk: { get: async () => result, put: async () => { writes += 1; } } });
    await assert.rejects(store.updateRecord('auth', {}, () => ({})), { code: 'STORE_READ_FAILED' });
    assert.equal(writes, 0);
  }
});

test('path traversal and URLs are rejected before reaching the SDK', () => {
  const fake = fakeSdk();
  const store = createBlobStore({ sdk: fake.api });
  for (const key of ['../auth', '/auth', 'a/b', 'a\\b', '%2e%2e', '', 'https://example.com', 'a'.repeat(161)]) {
    assert.throws(() => store.read(key), /Invalid private storage key/);
    assert.throws(() => store.updateRecord(key, {}, () => ({})), /Invalid private storage key/);
  }
  for (const prefix of ['../state', '/state', 'state/', 'state//auth', 'https://example.com']) {
    assert.throws(() => createBlobStore({ sdk: fake.api, prefix }), /Invalid private storage prefix/);
  }
  assert.equal(fake.calls.length, 0);
});

test('oversized reads and writes fail without exposing contents or writing a partial value', async () => {
  const fake = fakeSdk();
  const store = createBlobStore({ sdk: fake.api, maxBytes: 16 });
  await assert.rejects(store.updateRecord('small', null, () => ({ content: 'too much private data' })), { code: 'STORE_INVALID_DATA' });
  assert.equal(fake.calls.filter(call => call.method === 'put').length, 0);
  fake.api.get = async () => ({
    statusCode: 200, blob: { etag: '"valid"', size: null },
    stream: new Response(JSON.stringify({ content: 'too much private data' })).body,
  });
  await assert.rejects(store.readRecord('small', null), { code: 'STORE_READ_FAILED' });
});
