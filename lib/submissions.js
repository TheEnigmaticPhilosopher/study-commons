import { createHash, randomBytes } from 'node:crypto';

const problem = (status, message) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = value => typeof value === 'string' ? value.slice(0, 500) : '';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const types = ['online_text_entry', 'online_url', 'online_upload'];
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export const submissionRoute = path => /^\/api\/canvas\/assignments\/(\d{1,20})\/(\d{1,20})(?:\/(prepare|submit))?$/.exec(path);

export function validateDraft(value, assignment) {
  if (!value || !assignment.types.includes(value.type)) throw problem(400, 'Choose an allowed submission type.');
  if (value.type === 'online_text_entry') {
    if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 20000) throw problem(400, 'Enter between 1 and 20,000 characters.');
    return { type: value.type, text: value.text };
  }
  if (value.type === 'online_url') {
    let url;
    try { url = new URL(value.url); } catch { throw problem(400, 'Enter a complete http or https website URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2000) throw problem(400, 'Enter a website URL without embedded credentials.');
    return { type: value.type, url: url.href };
  }
  const file = value.file;
  if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 180 || /[\\/\x00-\x1f]/.test(file.name) ||
      typeof file.base64 !== 'string' || file.base64.length > 4 * 1024 * 1024 || file.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) throw problem(400, 'Choose a file up to 3 MiB with a valid filename.');
  const bytes = Buffer.from(file.base64, 'base64');
  if (bytes.toString('base64') !== file.base64) throw problem(400, 'The file encoding is invalid.');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw problem(400, 'Choose a nonempty file up to 3 MiB. Larger or multiple files can be submitted in Canvas.');
  if (assignment.extensions.length && !assignment.extensions.some(ext => file.name.toLowerCase().endsWith(`.${ext.toLowerCase()}`))) throw problem(400, 'This file extension is not allowed by the assignment.');
  return { type: value.type, file: { name: file.name, base64: file.base64 } };
}

// Only the token owner's assignment is addressed. No client-supplied user IDs,
// file IDs, timestamps, upload endpoints, or raw Canvas responses are accepted.
export function createSubmissions(config, store, { fetcher = fetch, now = Date.now } = {}) {
  async function json(response) {
    if (!response.ok) {
      const error = problem([401, 403, 404, 400, 422, 429].includes(response.status) ? response.status : 502,
        'Canvas could not accept this request. Check the assignment in Canvas and your token permissions.');
      error.definite = response.status >= 400 && response.status < 500;
      throw error;
    }
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 8 * 1024 * 1024) { await reader.cancel(); throw problem(502, 'Canvas returned an oversized response.'); }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw problem(502, 'Canvas returned an unreadable response.'); }
    finally { reader.releaseLock(); }
  }
  async function canvasRequest(path, body) {
    const url = new URL(path, config.baseUrl);
    if (url.origin !== config.baseUrl || url.username || url.password || url.hash || url.searchParams.has('access_token')) throw problem(502, 'Canvas returned an unsafe URL.');
    let response;
    try {
      response = await fetcher(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(body ? { body: new URLSearchParams(body) } : {}) });
    } catch { throw problem(502, 'Canvas did not confirm the request.'); }
    return json(response);
  }
  function receipt(raw, assignmentId) {
    if (!raw || String(raw.assignment_id) !== assignmentId || !Number.isInteger(raw.attempt ?? 0)) throw problem(502, 'Canvas returned a different assignment or an invalid receipt.');
    return { attempt: raw.attempt || 0, submittedAt: date(raw.submitted_at), late: raw.late === true,
      state: ['submitted', 'graded', 'pending_review'].includes(raw.workflow_state) ? 'submitted' : 'unsubmitted' };
  }
  async function detail(courseId, assignmentId) {
    const account = await store.read(config.accountKey);
    const record = account.snapshot?.courses.find(item => item.course.id === courseId);
    if (!record?.assignments.some(item => item.id === assignmentId)) throw problem(404, 'Choose an assignment from an imported course.');
    if (config.mode !== 'live') throw problem(409, 'Submissions require a live personal Canvas connection. The fictional demo never sends work.');
    if (config.accountMissing.length) throw problem(503, 'Complete the private Canvas settings first.');
    const path = `/api/v1/courses/${courseId}/assignments/${assignmentId}`;
    const raw = await canvasRequest(`${path}?include[]=can_submit&include[]=academic_integrity_pledge`);
    if (String(raw.id) !== assignmentId || String(raw.course_id) !== courseId) throw problem(502, 'Canvas returned a different assignment.');
    const current = receipt(raw.submission || (raw.can_submit !== true ? { assignment_id: assignmentId, attempt: 0 } : null), assignmentId);
    const allowed = Array.isArray(raw.submission_types) ? raw.submission_types.filter(type => types.includes(type)) : [];
    let reason = '';
    if (raw.group_category_id || raw.academic_integrity_pledge || raw.require_lockdown_browser || raw.is_quiz_assignment || raw.quiz_id || raw.turnitin_enabled || raw.vericite_enabled) reason = 'This assignment requires a group, quiz, integrity agreement, or external tool workflow. Complete it in Canvas.';
    else if (!allowed.length) reason = 'This assignment uses a submission type that must be completed in Canvas.';
    else if (raw.can_submit !== true || raw.locked_for_user || raw.published === false) reason = 'Canvas is not currently allowing a submission. Check availability, enrollment, and remaining attempts in Canvas.';
    return { courseId, assignmentId, courseName: clean(record.course.name), title: clean(raw.name),
      url: `${config.baseUrl}/courses/${courseId}/assignments/${assignmentId}`, dueAt: date(raw.due_at), lockAt: date(raw.lock_at),
      types: allowed, extensions: Array.isArray(raw.allowed_extensions) ? raw.allowed_extensions.filter(v => typeof v === 'string').map(clean) : [],
      allowedAttempts: Number.isInteger(raw.allowed_attempts) && raw.allowed_attempts >= 0 ? raw.allowed_attempts : null,
      current, canSubmit: !reason, reason };
  }
  async function upload(path, file) {
    const bytes = Buffer.from(file.base64, 'base64');
    const intent = await canvasRequest(`${path}/submissions/self/files`, { name: file.name, size: String(bytes.length), content_type: 'application/octet-stream', on_duplicate: 'rename' });
    let url;
    try { url = new URL(intent.upload_url); } catch { throw problem(502, 'Canvas returned an invalid upload destination. Submit this file in Canvas.'); }
    const s3 = /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || (url.origin !== config.baseUrl && !s3)) throw problem(502, 'This Canvas file host is not supported by the pilot. Submit the file in Canvas.');
    if (!intent.upload_params || typeof intent.upload_params !== 'object' || Array.isArray(intent.upload_params)) throw problem(502, 'Canvas returned invalid upload parameters.');
    const form = new FormData();
    for (const [key, value] of Object.entries(intent.upload_params)) form.append(key, String(value));
    form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), file.name);
    // Signed upload parameters authorize the file host; never forward the Canvas token.
    const response = await fetcher(url, { method: 'POST', body: form, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    let uploaded;
    if ([301, 302, 303, 307, 308, 201].includes(response.status) && response.headers.get('location')) {
      const location = new URL(response.headers.get('location'), url);
      if (location.origin !== config.baseUrl || !/^\/api\/v1\/files\/\d+(?:\/create_success)?$/.test(location.pathname)) throw problem(502, 'Canvas returned an unsupported upload confirmation. Check the file in Canvas.');
      uploaded = await canvasRequest(location.href);
    } else { uploaded = await json(response); }
    if (!/^\d+$/.test(String(uploaded.id))) throw problem(502, 'Canvas did not confirm the uploaded file.');
    return String(uploaded.id);
  }
  const keyFor = (course, assignment) => `submit-${hash([config.accountKey, course, assignment])}`;
  return {
    async handle(request, path, readJson) {
      const match = submissionRoute(path);
      if (!match) return null;
      const [, courseId, assignmentId, action] = match;
      if ((!action && request.method !== 'GET') || (action && request.method !== 'POST')) throw problem(405, 'Method not allowed.');
      const key = keyFor(courseId, assignmentId);
      if (!action) {
        const assignment = await detail(courseId, assignmentId);
        const saved = await store.readRecord(key, null);
        return { assignment, delivery: saved ? { status: saved.status, receipt: saved.receipt || null,
          resolved: saved.status === 'uncertain' && assignment.current.attempt > saved.attempt } : null };
      }
      const body = await readJson(request, 4 * 1024 * 1024 + 32768);
      if (action === 'submit') {
        const previous = await store.readRecord(key, null);
        if (!previous || previous.reviewId !== body.reviewId || body.confirm !== true) throw problem(400, 'Review this submission and explicitly confirm it first.');
        // An exact retry retrieves the saved receipt without another Canvas write.
        if (previous.status === 'submitted') return { status: 'submitted', receipt: previous.receipt };
        if (previous.status !== 'review') throw problem(409, 'This submission was already sent or its delivery is uncertain. Check Canvas before attempting more work.');
      }
      const assignment = await detail(courseId, assignmentId);
      if (!assignment.canSubmit) throw problem(409, assignment.reason);
      const draft = validateDraft(body.draft, assignment);
      const fingerprint = hash(draft);
      if (action === 'prepare') {
        const reviewId = randomBytes(24).toString('hex');
        const review = { reviewId, fingerprint, status: 'review', expires: now() + 10 * 60000, attempt: assignment.current.attempt };
        await store.updateRecord(key, null, current => {
          if (current?.status === 'sending' || (current?.status === 'uncertain' && assignment.current.attempt <= current.attempt)) throw problem(409, 'A previous submission has no confirmed receipt. Check Canvas before submitting again.');
          return review;
        });
        return { reviewId, expires: review.expires, assignment };
      }
      // CAS claims one review even across concurrent serverless invocations.
      await store.updateRecord(key, null, current => {
        if (!current || current.reviewId !== body.reviewId || current.status !== 'review' || current.expires < now() || current.fingerprint !== fingerprint || current.attempt !== assignment.current.attempt) throw problem(409, 'The draft, assignment attempt, or review changed. Review it again before submitting.');
        return { ...current, status: 'sending' };
      });
      const pathBase = `/api/v1/courses/${courseId}/assignments/${assignmentId}`;
      let sent = false;
      try {
        const fields = { 'submission[submission_type]': draft.type };
        if (draft.type === 'online_text_entry') fields['submission[body]'] = `<p>${escape(draft.text).replace(/\r?\n/g, '<br>')}</p>`;
        if (draft.type === 'online_url') fields['submission[url]'] = draft.url;
        if (draft.type === 'online_upload') fields['submission[file_ids][]'] = await upload(pathBase, draft.file);
        sent = true;
        const result = receipt(await canvasRequest(`${pathBase}/submissions`, fields), assignmentId);
        if (result.state !== 'submitted' || !result.submittedAt || result.attempt <= assignment.current.attempt) throw problem(502, 'Canvas did not confirm a new submission.');
        await store.updateRecord(key, null, current => ({ ...current, status: 'submitted', receipt: result }));
        return { status: 'submitted', receipt: result };
      } catch (error) {
        const uncertain = sent && !error.definite;
        await store.updateRecord(key, null, current => ({ ...current, status: uncertain ? 'uncertain' : 'failed' }));
        throw problem(uncertain ? 409 : 502, uncertain
          ? 'Delivery is uncertain. Do not resend: open Canvas to check whether your submission arrived. Study Commons will not automatically retry.'
          : 'No assignment submission was confirmed. Check Canvas before reviewing again. A file may have uploaded without being submitted.');
      }
    },
  };
}
