import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readConfig } from '../lib/config.js';
import { createStore } from '../lib/store.js';
import { createApi } from '../lib/api.js';
import { createCloudApi } from '../lib/cloud-api.js';
import { createSubmissions, validateDraft, MAX_FILE_BYTES } from '../lib/submissions.js';

const base = 'https://school.instructure.com';
const password = 'submission-test-password-only';
const path = '/api/canvas/assignments/123/456';
const answer = { type: 'online_text_entry', text: 'My work <script>not HTML</script>\nSecond line.' };
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
function setup(t, overrides = {}) {
  const config = readConfig({ CANVAS_MODE: 'live', CANVAS_BASE_URL: base, CANVAS_ACCESS_TOKEN: 'test-token', HUB_ADMIN_PASSWORD: password });
  const store = createStore(); t.after(() => store.close());
  store.update = (key, fn) => store.updateRecord(key, { snapshot: null, mappings: [] }, fn);
  store.write(config.accountKey, { snapshot: { courses: [{ course: { id: '123', name: 'Test calculus' }, assignments: [{ id: '456' }] }] } });
  const calls = []; let attempt = 0; let time = Date.now();
  const raw = () => ({ id: 456, course_id: 123, name: 'Related rates', can_submit: true, published: true,
    submission_types: ['online_text_entry', 'online_url', 'online_upload'], allowed_extensions: ['pdf'],
    submission: { assignment_id: 456, attempt, workflow_state: attempt ? 'submitted' : 'unsubmitted', user_id: 1, score: 99.999, grade: 'PRIVATE-GRADE', submission_comments: [{ comment: 'PRIVATE-COMMENT' }] },
    ...overrides.assignment });
  const fetcher = async (input, options) => {
    const url = new URL(input); calls.push({ url, options });
    if (overrides.fetcher) { const result = await overrides.fetcher(url, options); if (result) return result; }
    if (options.method === 'GET' && url.pathname.endsWith('/assignments/456')) return reply(raw());
    if (options.method === 'POST' && url.pathname.endsWith('/submissions/self/files')) return reply({ upload_url: 'https://school-files.s3.amazonaws.com/', upload_params: { key: 'opaque', policy: 'signed' } });
    if (url.hostname === 'school-files.s3.amazonaws.com') return new Response(null, { status: 301, headers: { location: `${base}/api/v1/files/88/create_success?uuid=xyz` } });
    if (options.method === 'GET' && url.pathname === '/api/v1/files/88/create_success') return reply({ id: 88 });
    if (options.method === 'POST' && url.pathname.endsWith('/submissions')) {
      attempt++;
      return reply({ assignment_id: 456, attempt, workflow_state: 'submitted', submitted_at: '2026-10-06T12:00:00Z', late: false, score: 99.999, grade: 'PRIVATE-GRADE', body: 'PRIVATE-BODY' });
    }
    throw Error('Unexpected fixture request');
  };
  const service = createSubmissions(config, store, { fetcher, now: () => time });
  const call = (action = '', body) => service.handle({ method: action ? 'POST' : 'GET' }, path + action, async () => body);
  return { config, store, calls, fetcher, call, advance: ms => { time += ms; }, setAttempt: n => { attempt = n; }, writes: () => calls.filter(c => c.options.method === 'POST' && c.url.pathname.endsWith('/submissions')) };
}

test('review does not write to Canvas; explicit confirmation sends escaped text once and strips real grades', async t => {
  const p = setup(t);
  const metadata = await p.call();
  assert.equal(metadata.assignment.canSubmit, true);
  assert.doesNotMatch(JSON.stringify(metadata), /PRIVATE|99\.999|user_id/);
  const review = await p.call('/prepare', { draft: answer });
  assert.equal(p.writes().length, 0);
  await assert.rejects(p.call('/submit', { draft: answer, reviewId: review.reviewId }), /explicitly confirm/);
  const result = await p.call('/submit', { draft: answer, reviewId: review.reviewId, confirm: true, user_id: 999 });
  assert.equal(result.receipt.attempt, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|99\.999|score|grade|user_id/);
  const sent = p.writes()[0].options.body;
  assert.equal(sent.get('submission[body]'), '<p>My work &lt;script&gt;not HTML&lt;/script&gt;<br>Second line.</p>');
  assert.equal(sent.has('submission[user_id]'), false);
  assert.equal(sent.has('submission[submitted_at]'), false);
  assert.deepEqual(await p.call('/submit', { draft: answer, reviewId: review.reviewId, confirm: true }), result);
  assert.equal(p.writes().length, 1);
  const saved = p.store.readRecord(`submit-${(await import('node:crypto')).createHash('sha256').update(JSON.stringify([p.config.accountKey, '123', '456'])).digest('hex')}`, null);
  assert.doesNotMatch(JSON.stringify(saved), /My work|PRIVATE|base64/);
});

test('concurrent confirmations create only one submission', async t => {
  const p = setup(t); const review = await p.call('/prepare', { draft: answer });
  const body = { draft: answer, reviewId: review.reviewId, confirm: true };
  const results = await Promise.allSettled([p.call('/submit', body), p.call('/submit', body)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(p.writes().length, 1);
});

test('changed, expired, replaced and externally resubmitted reviews cannot send', async t => {
  const p = setup(t); let review = await p.call('/prepare', { draft: answer });
  await assert.rejects(p.call('/submit', { reviewId: review.reviewId, draft: { ...answer, text: 'Changed' }, confirm: true }), /changed/);
  p.advance(600001);
  await assert.rejects(p.call('/submit', { reviewId: review.reviewId, draft: answer, confirm: true }), /changed/);
  review = await p.call('/prepare', { draft: answer });
  await p.call('/prepare', { draft: answer });
  await assert.rejects(p.call('/submit', { reviewId: review.reviewId, draft: answer, confirm: true }), /Review/);
  review = await p.call('/prepare', { draft: answer }); p.setAttempt(2);
  await assert.rejects(p.call('/submit', { reviewId: review.reviewId, draft: answer, confirm: true }), /changed/);
  assert.equal(p.writes().length, 0);
});

for (const assignment of [{ can_submit: false }, { locked_for_user: true }, { group_category_id: 7 }, { academic_integrity_pledge: 'Agree' }, { is_quiz_assignment: true }, { turnitin_enabled: true }, { submission_types: ['external_tool'] }]) {
  test(`unsupported or unavailable assignment stays in Canvas: ${JSON.stringify(assignment)}`, async t => {
    const p = setup(t, { assignment });
    assert.equal((await p.call()).assignment.canSubmit, false);
    await assert.rejects(p.call('/prepare', { draft: answer }));
    assert.equal(p.writes().length, 0);
  });
}

test('timeout is uncertain, blocks resending and can reconcile an advanced Canvas attempt', async t => {
  const p = setup(t, { fetcher: async (url, opts) => { if (opts.method === 'POST' && url.pathname.endsWith('/submissions')) throw Error('lost response'); } });
  const review = await p.call('/prepare', { draft: answer });
  const body = { reviewId: review.reviewId, draft: answer, confirm: true };
  await assert.rejects(p.call('/submit', body), /Delivery is uncertain/);
  await assert.rejects(p.call('/submit', body), /already sent/);
  await assert.rejects(p.call('/prepare', { draft: answer }), /no confirmed receipt/);
  assert.equal((await p.call()).delivery.resolved, false);
  p.setAttempt(1);
  assert.equal((await p.call()).delivery.resolved, true);
  assert.ok((await p.call('/prepare', { draft: answer })).reviewId);
  assert.equal(p.writes().length, 1);
});

test('URL submission is constrained and only sends the allowed URL field', async t => {
  const p = setup(t); const draft = { type: 'online_url', url: 'https://example.com/work' };
  const review = await p.call('/prepare', { draft });
  await p.call('/submit', { reviewId: review.reviewId, draft, confirm: true });
  assert.deepEqual([...p.writes()[0].options.body], [['submission[submission_type]', 'online_url'], ['submission[url]', draft.url]]);
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'file:///x']) assert.throws(() => validateDraft({ ...draft, url }, { types: ['online_url'] }));
});

test('file submission follows signed upload and confirmation without leaking bearer credentials', async t => {
  const p = setup(t); const draft = { type: 'online_upload', file: { name: 'work.pdf', base64: Buffer.from('fixture PDF').toString('base64') } };
  const review = await p.call('/prepare', { draft });
  assert.equal(p.calls.some(c => c.options.method === 'POST'), false);
  await p.call('/submit', { reviewId: review.reviewId, draft, confirm: true });
  const upload = p.calls.find(c => c.url.hostname === 'school-files.s3.amazonaws.com');
  assert.equal(upload.options.headers, undefined);
  assert.equal(upload.options.redirect, 'manual');
  assert.deepEqual([...upload.options.body.keys()], ['key', 'policy', 'file']);
  assert.equal(p.writes()[0].options.body.get('submission[file_ids][]'), '88');
  assert.equal(p.calls.find(c => c.url.pathname.endsWith('/create_success')).options.headers.Authorization, 'Bearer test-token');
});

test('file validation rejects disallowed extensions, oversized files and malformed base64', () => {
  const assignment = { types: ['online_upload'], extensions: ['pdf'] };
  for (const file of [{ name: 'bad.exe', base64: 'YQ==' }, { name: 'work.pdf', base64: '!!' }, { name: '../work.pdf', base64: 'YQ==' }, { name: 'work.pdf', base64: Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64') }]) assert.throws(() => validateDraft({ type: 'online_upload', file }, assignment));
  const largest = { type: 'online_upload', file: { name: 'work.pdf', base64: Buffer.alloc(MAX_FILE_BYTES).toString('base64') } };
  assert.equal(validateDraft(largest, assignment).file.base64.length, 4 * 1024 * 1024);
});

test('unsafe upload redirects never receive Canvas credentials or submit an assignment', async t => {
  const p = setup(t, { fetcher: async url => url.hostname === 'school-files.s3.amazonaws.com' ? new Response(null, { status: 301, headers: { location: 'https://evil.example/api/v1/files/88/create_success' } }) : null });
  const draft = { type: 'online_upload', file: { name: 'work.pdf', base64: 'YQ==' } };
  const review = await p.call('/prepare', { draft });
  await assert.rejects(p.call('/submit', { reviewId: review.reviewId, draft, confirm: true }), /No assignment submission/);
  assert.equal(p.calls.some(c => c.url.hostname === 'evil.example'), false);
  assert.equal(p.writes().length, 0);
});

test('demo mode and assignments outside the imported account never contact Canvas', async t => {
  const p = setup(t);
  const service = createSubmissions({ ...p.config, mode: 'demo' }, p.store, { fetcher: p.fetcher });
  await assert.rejects(service.handle({ method: 'GET' }, path), /fictional demo/);
  await assert.rejects(service.handle({ method: 'GET' }, path.replace('456', '999')), /imported course/);
  assert.equal(p.calls.length, 0);
});

for (const factory of [createApi, createCloudApi]) {
  test(`${factory.name}: authentication and same-origin checks protect every submission route`, async t => {
    const p = setup(t); const api = factory(p.config, p.store, { fetcher: p.fetcher }); t.after(() => api.close());
    async function call(url, { body, cookie = '', origin = p.config.origin } = {}) {
      const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
      Object.assign(req, { url, method: body ? 'POST' : 'GET', headers: { cookie, origin, 'content-type': 'application/json' } });
      const result = { headers: {} };
      const res = { setHeader: (key, val) => { result.headers[key] = val; }, writeHead: status => { result.status = status; }, end: data => { result.body = JSON.parse(data); } };
      await api(req, res, url); return result;
    }
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path + '/submit', { body: { confirm: true } })).status, 401);
    const login = await call('/api/login', { body: { password } });
    const cookie = login.headers['Set-Cookie'].split(';')[0];
    assert.equal((await call(path + '/prepare', { cookie, origin: 'https://evil.example', body: { draft: answer } })).status, 403);
    assert.equal(p.calls.length, 0);
    assert.equal((await call(path, { cookie })).body.assignment.canSubmit, true);
    const review = await call(path + '/prepare', { cookie, body: { draft: answer } });
    assert.equal(review.status, 200);
    assert.equal((await call(path + '/submit', { cookie, body: { reviewId: review.body.reviewId, draft: answer, confirm: true } })).status, 200);
    assert.equal(p.writes().length, 1);
  });
}
