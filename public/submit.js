import { escapeHTML as e } from './state.js';

const main = document.getElementById('submission-main');
const params = new URLSearchParams(location.search);
const course = params.get('course'); const assignmentId = params.get('assignment');
const endpoint = `/api/canvas/assignments/${course}/${assignmentId}`;
const labels = { online_text_entry: 'Text entry', online_url: 'Website URL', online_upload: 'File upload' };
let assignment, review, draft, delivery, receipt, sending = false, preparing = false, dirty = false, expired = false;
const when = value => value ? new Date(value).toLocaleString() : 'Not set';
async function api(path = '', body) {
  const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (response.status === 401) {
    expired = true; draft = review = assignment = receipt = null; dirty = false;
    main.innerHTML = '<h1>Sign in to continue</h1><p>Your session has ended. Sign in, then reopen this assignment from your course.</p><div class="actions"><a class="button" href="/#canvas">Personal pilot sign-in</a></div>';
  }
  if (!response.ok) throw Error(value.error || 'Unable to contact Study Commons.');
  return value;
}
function alert(message) {
  if (expired) return;
  const target = document.getElementById('submission-alert');
  if (target) { target.textContent = message; target.hidden = !message; target.focus(); }
}
function header() {
  return `<a href="/#canvas-course/${e(course)}/assignments">← Back to assignments</a><div class="page-heading"><div><p class="eyebrow">${e(assignment.courseName)}</p><h1>${e(assignment.title)}</h1><p class="muted">Due ${e(when(assignment.dueAt))}${assignment.lockAt ? ` · Closes ${e(when(assignment.lockAt))}` : ''}</p></div></div>
    <p><a href="${e(assignment.url)}" target="_blank" rel="noopener noreferrer">Read full instructions and view your submission in Canvas ↗</a></p>
    <p class="canvas-alert">This sends real work to your connected personal Canvas account. The sample grades elsewhere in Study Commons do not affect submissions.</p>
    <p class="meta">${assignment.current.attempt ? `Canvas already has ${assignment.current.attempt} submission attempt(s). Submitting again creates another attempt.` : 'No previous submission attempt is shown.'}${assignment.allowedAttempts !== null ? ` Allowed attempts: ${assignment.allowedAttempts}.` : ''}</p>
    <p id="submission-alert" class="canvas-alert" role="alert" tabindex="-1" hidden></p>`;
}
function render() {
  if (!assignment || expired) return;
  if (receipt) {
    main.innerHTML = header() + `<section class="canvas-panel"><h2>Canvas confirmed your submission</h2><p>Attempt ${e(receipt.attempt)} · ${e(when(receipt.submittedAt))}${receipt.late ? ' · Marked late by Canvas' : ''}</p><p>Check the original assignment in Canvas for the submitted work and any instructor feedback.</p>${assignment.canSubmit ? '<div class="actions"><button id="another-attempt">Prepare another attempt</button></div>' : ''}</section>`;
    document.getElementById('another-attempt')?.addEventListener('click', () => { receipt = null; delivery = null; render(); });
    return;
  }
  const pending = ['sending', 'uncertain'].includes(delivery?.status) && !delivery.resolved;
  if (!assignment.canSubmit || pending) {
    main.innerHTML = header() + `<section class="canvas-panel"><h2>${pending ? 'Check delivery in Canvas' : 'Continue in Canvas'}</h2><p>${e(pending ? 'A previous request has no confirmed receipt. Check Canvas before sending anything else.' : assignment.reason)}</p><div class="actions"><button id="check-delivery">Refresh submission status</button></div></section>`;
    document.getElementById('check-delivery').addEventListener('click', load);
    return;
  }
  if (review) {
    const preview = draft.type === 'online_text_entry' ? draft.text : draft.type === 'online_url' ? draft.url : `${draft.file.name} (${Math.round(draft.file.base64.length * 0.75 / 1024)} KiB)`;
    main.innerHTML = header() + `<section class="canvas-panel"><h2>Review your submission</h2><p>${e(labels[draft.type])} · Review valid until ${e(when(review.expires))}</p><pre class="submission-preview">${e(preview)}</pre>
      <form id="confirm-submission"><label class="submission-consent"><input type="checkbox" name="confirm" required> I have checked the assignment and want to submit this work to my Canvas account.</label><div class="actions"><button class="primary" ${sending ? 'disabled' : ''}>${sending ? 'Waiting for Canvas…' : 'Submit to Canvas'}</button><button type="button" id="edit-draft" ${sending ? 'disabled' : ''}>Edit draft</button></div></form></section>`;
    document.getElementById('edit-draft').addEventListener('click', () => { review = null; render(); });
    document.getElementById('confirm-submission').addEventListener('submit', submit);
    return;
  }
  draft ||= { type: assignment.types[0], text: '', url: '' };
  main.innerHTML = header() + `<section class="canvas-panel"><h2>Prepare your work</h2><p class="muted">Drafts stay in this tab until you send them. Keep a separate copy before leaving or reloading.</p><form id="draft-form">
    <label>Submission type<select id="submission-type">${assignment.types.map(type => `<option value="${type}" ${draft.type === type ? 'selected' : ''}>${labels[type]}</option>`).join('')}</select></label>
    ${draft.type === 'online_text_entry' ? `<label>Your answer<textarea id="answer" rows="12" maxlength="20000" required>${e(draft.text || '')}</textarea></label>`
      : draft.type === 'online_url' ? `<label>Website URL<input id="answer" type="url" value="${e(draft.url || '')}" maxlength="2000" placeholder="https://…" required></label>`
      : `<label>File<input id="answer" type="file" ${assignment.extensions.length ? `accept="${e(assignment.extensions.map(ext => `.${ext}`).join(','))}"` : ''}></label><p class="meta">One file, up to 3 MiB.${assignment.extensions.length ? ` Allowed: ${e(assignment.extensions.join(', '))}.` : ''} For multiple or larger files, use Canvas.</p>${draft.file ? `<p>Selected: ${e(draft.file.name)}</p>` : ''}`}
    <div class="actions"><button class="primary">Review submission</button></div></form></section>`;
  document.getElementById('submission-type').addEventListener('change', event => { draft.type = event.target.value; render(); });
  document.getElementById('answer').addEventListener('input', event => {
    dirty = true;
    if (draft.type === 'online_text_entry') draft.text = event.target.value;
    if (draft.type === 'online_url') draft.url = event.target.value;
  });
  document.getElementById('draft-form').addEventListener('submit', prepare);
}
async function prepare(event) {
  event.preventDefault();
  if (sending || preparing) return;
  preparing = true;
  const controls = [...event.target.querySelectorAll('input,select,textarea')];
  controls.forEach(control => { control.disabled = true; });
  const button = event.target.querySelector('button'); button.disabled = true; button.textContent = 'Checking Canvas…';
  try {
    if (draft.type === 'online_upload') {
      const file = document.getElementById('answer').files[0];
      if (file) {
        if (!file.size || file.size > 3 * 1024 * 1024) throw Error('Choose a nonempty file up to 3 MiB.');
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(Error('Unable to read this file.')); reader.readAsDataURL(file);
        });
        draft.file = { name: file.name, base64 };
      }
      if (!draft.file) throw Error('Choose the file you want to submit.');
    }
    const result = await api('/prepare', { draft });
    review = result; assignment = result.assignment; dirty = true; render();
  } catch (error) { alert(error.message); }
  finally { preparing = false; controls.forEach(control => { control.disabled = false; }); button.disabled = false; button.textContent = 'Review submission'; }
}
async function submit(event) {
  event.preventDefault();
  if (sending || !event.target.elements.confirm.checked) return;
  sending = true; render();
  try {
    const result = await api('/submit', { draft, reviewId: review.reviewId, confirm: true });
    receipt = result.receipt; assignment.current = receipt;
    if (assignment.allowedAttempts !== null && receipt.attempt >= assignment.allowedAttempts) assignment.canSubmit = false;
    draft = review = null; dirty = false; render();
  } catch (error) {
    if (!expired) {
      const message = error.message;
      review = null; delivery = { status: 'uncertain' }; render(); alert(message);
    }
  } finally { sending = false; }
}
async function load() {
  try {
    const result = await api(); assignment = result.assignment; delivery = result.delivery;
    if (delivery?.status === 'submitted') { receipt = delivery.receipt; draft = review = null; dirty = false; }
    // Canvas may confirm an attempt after the original request timed out. We
    // display its status, but do not claim it matches an uncertain draft.
    render();
  } catch (error) {
    if (!expired) main.innerHTML = `<h1>Unable to open this assignment</h1><p role="alert">${e(error.message)}</p><div class="actions"><a class="button" href="/#canvas">Canvas connection</a></div>`;
  }
}
window.addEventListener('beforeunload', event => { if (dirty || sending) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pageshow', event => { if (event.persisted) { draft = review = receipt = assignment = null; dirty = false; main.textContent = 'Checking your session…'; load(); } });
if (/^\d{1,20}$/.test(course) && /^\d{1,20}$/.test(assignmentId)) load();
else main.innerHTML = '<h1>Choose an assignment</h1><a href="/#dashboard">Open your linked courses</a>';
