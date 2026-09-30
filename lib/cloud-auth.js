import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_SECONDS = 8 * 3600;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const ATTEMPT_LIMIT = 20;
const hash = value => createHash('sha256').update(value).digest();
const tokenPattern = /^[a-f0-9]{64}$/;

class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createCloudAuth(config, store, { now = Date.now } = {}) {
  const password = typeof config.password === 'string' ? config.password : '';
  const passwordHash = hash(password);
  const binding = hash(JSON.stringify([config.accountKey, passwordHash.toString('hex')])).toString('hex');
  const sessionKey = token => `auth-session-${hash(token).toString('hex')}`;
  const cookie = (value, age) => `hub_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.origin?.startsWith('https:') ? '; Secure' : ''}`;

  async function storage(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(503, 'Sign-in storage is temporarily unavailable. Try again later.');
    }
  }

  function requestToken(request) {
    const header = typeof request?.headers?.get === 'function'
      ? request.headers.get('cookie') : request?.headers?.cookie;
    if (typeof header !== 'string' || header.length > 8192) return null;
    const entries = header.split(';').map(value => value.trim()).filter(value => value.startsWith('hub_session='));
    if (entries.length !== 1) return null;
    const token = entries[0].slice('hub_session='.length);
    return tokenPattern.test(token) ? token : null;
  }

  return {
    async authenticate(request) {
      if (!password) return null;
      const token = requestToken(request);
      if (!token) return null;
      const record = await storage(() => store.readRecord(sessionKey(token), null));
      return record?.binding === binding && Number.isFinite(record.expires) && record.expires > now() ? token : null;
    },

    async login(candidate, priorSessionToken = null) {
      if (!password) throw new AuthError(503, 'Set HUB_ADMIN_PASSWORD on the server to enable the private pilot.');
      const attemptedAt = now();
      await storage(() => store.updateRecord('auth-login-attempts', { attempts: [] }, record => {
        const attempts = (Array.isArray(record?.attempts) ? record.attempts : [])
          .filter(time => Number.isFinite(time) && attemptedAt - time < ATTEMPT_WINDOW_MS);
        if (attempts.length >= ATTEMPT_LIMIT) throw new AuthError(429, 'Too many sign-in attempts. Try again in five minutes.');
        return { attempts: [...attempts, attemptedAt] };
      }));
      if (typeof candidate !== 'string' || !timingSafeEqual(hash(candidate), passwordHash)) {
        throw new AuthError(401, 'Incorrect pilot password.');
      }
      if (typeof priorSessionToken === 'string' && tokenPattern.test(priorSessionToken)) {
        await storage(() => store.updateRecord(sessionKey(priorSessionToken), null, record =>
          record?.binding === binding ? { binding, expires: 0 } : undefined));
      }
      const token = randomBytes(32).toString('hex');
      const record = { binding, expires: now() + SESSION_SECONDS * 1000 };
      await storage(() => store.updateRecord(sessionKey(token), null, () => record));
      return { cookie: cookie(token, SESSION_SECONDS) };
    },

    async logout(token) {
      if (typeof token === 'string' && tokenPattern.test(token)) {
        await storage(() => store.updateRecord(sessionKey(token), null, record =>
          record?.binding === binding ? { binding, expires: 0 } : undefined));
      }
      return { cookie: cookie('', 0) };
    },
  };
}
