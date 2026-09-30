const emptyState = () => ({ snapshot: null, mappings: [], lastAttempt: null, lastError: null });
const validKey = /^[A-Za-z0-9_-]{1,160}$/;
const validPrefix = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export class BlobStoreError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BlobStoreError';
    this.code = code;
  }
}

function failure(operation, error) {
  // Provider type/status help diagnose hosted failures without logging signed URLs,
  // response bodies, request headers, credentials, or imported course content.
  if (process.env.VERCEL) console.error('Private storage failure', JSON.stringify({ operation,
    type: /^[A-Za-z]{1,80}$/.test(error?.constructor?.name || '') ? error.constructor.name : 'Unknown',
    status: Number.isInteger(error?.statusCode) ? error.statusCode : undefined }));
  return new BlobStoreError(`Private storage ${operation} failed. Please try again.`, `STORE_${operation.toUpperCase()}_FAILED`);
}

/**
 * Private persistent state for serverless instances. Requires @vercel/blob >=2.6.1.
 * The SDK manages BLOB_STORE_ID / VERCEL_OIDC_TOKEN and its refresh automatically,
 * or falls back to BLOB_READ_WRITE_TOKEN. An explicit token overrides SDK auth.
 *
 * update/updateRecord mutators receive a copy and must return the entire next
 * JSON value. They may run again after a conflict: do not perform side effects.
 * Returning undefined leaves storage unchanged and returns the original value.
 */
export function createBlobStore({
  token, storeId, prefix = 'study-commons/v1', sdk,
  maxAttempts = 8, maxBytes = 32 * 1024 * 1024, operationTimeoutMs = 30_000,
} = {}) {
  if (typeof prefix !== 'string' || prefix.length > 200 || !validPrefix.test(prefix)) {
    throw new TypeError('Invalid private storage prefix.');
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 50
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1
      || !Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1) {
    throw new TypeError('Invalid private storage limits.');
  }
  const auth = { ...(token ? { token } : {}), ...(storeId ? { storeId } : {}) };
  let sdkPromise;
  async function client() {
    try {
      const result = sdk ?? await (sdkPromise ??= import('@vercel/blob'));
      if (typeof result.get !== 'function' || typeof result.put !== 'function') throw new Error();
      return result;
    } catch {
      throw new BlobStoreError('Private storage is not available. Check its server configuration.', 'STORE_UNAVAILABLE');
    }
  }
  function pathname(namespace, key) {
    if (typeof key !== 'string' || !validKey.test(key)) throw new TypeError('Invalid private storage key.');
    return `${prefix}/${namespace}/${key}.json`;
  }
  function encode(value) {
    try {
      const json = JSON.stringify(value);
      if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > maxBytes) throw new Error();
      return json;
    } catch {
      throw new BlobStoreError('Private storage data is invalid or too large.', 'STORE_INVALID_DATA');
    }
  }
  const copy = (value) => JSON.parse(encode(value));

  async function readVersion(path, defaultValue, api) {
    try {
      // A cached ETag/body can invalidate authentication decisions or lose updates.
      const result = await api.get(path, {
        ...auth, access: 'private', useCache: false,
        // Conditional writes need the original strong ETag. HTTP compression can
        // weaken the ETag on larger JSON responses, causing every CAS to fail.
        headers: { 'Accept-Encoding': 'identity' },
        abortSignal: AbortSignal.timeout(operationTimeoutMs),
      });
      // get() converts a missing blob's HTTP 404 into null. Other errors must fail.
      if (result === null) return { value: copy(defaultValue), etag: null };
      if (result.statusCode !== 200 || !result.stream || typeof result.blob?.etag !== 'string'
          || !result.blob.etag || (result.blob.size ?? 0) > maxBytes) throw new Error();
      const reader = result.stream.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new Error();
          chunks.push(Buffer.from(value));
        }
      } catch {
        await reader.cancel().catch(() => {});
        throw new Error();
      } finally {
        reader.releaseLock();
      }
      return { value: JSON.parse(Buffer.concat(chunks, size).toString('utf8')), etag: result.blob.etag };
    } catch (error) {
      // Do not attach SDK errors as causes: they may contain signed URLs/tokens.
      throw failure('read', error);
    }
  }

  async function readAt(path, defaultValue) {
    const api = await client();
    return (await readVersion(path, defaultValue, api)).value;
  }

  async function updateAt(path, defaultValue, mutator) {
    if (typeof mutator !== 'function') throw new TypeError('Private storage updates require a mutator.');
    const api = await client();
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const current = await readVersion(path, defaultValue, api);
      const next = await mutator(copy(current.value));
      if (next === undefined) return current.value;
      const body = encode(next);
      try {
        await api.put(path, body, {
          ...auth, access: 'private', addRandomSuffix: false,
          contentType: 'application/json; charset=utf-8', cacheControlMaxAge: 60,
          abortSignal: AbortSignal.timeout(operationTimeoutMs),
          // Missing blobs must be created conditionally; ifMatch requires overwrite.
          ...(current.etag === null
            ? { allowOverwrite: false }
            : { allowOverwrite: true, ifMatch: current.etag }),
        });
        return JSON.parse(body);
      } catch (error) {
        const changed = typeof api.BlobPreconditionFailedError === 'function'
          && error instanceof api.BlobPreconditionFailedError;
        // Vercel currently exposes duplicate creation as a general BlobError.
        const created = current.etag === null && typeof api.BlobError === 'function'
          && error instanceof api.BlobError
          && /^Vercel Blob: This blob already exists(?:,|\.)/.test(error.message);
        if (!changed && !created) throw failure('write', error);
      }
    }
    throw new BlobStoreError('Private storage changed during this update. Please try again.', 'STORE_BUSY');
  }

  return {
    read(source) { return readAt(pathname('states', source), emptyState()); },
    update(source, mutator) { return updateAt(pathname('states', source), emptyState(), mutator); },
    // Whole-value replacement is for explicit imports only. Use update to merge
    // with current mappings, authentication state, or work from another instance.
    write(source, value) { return updateAt(pathname('states', source), emptyState(), () => value); },
    readRecord(key, defaultValue) { return readAt(pathname('records', key), defaultValue); },
    updateRecord(key, defaultValue, mutator) { return updateAt(pathname('records', key), defaultValue, mutator); },
    close() {},
  };
}
