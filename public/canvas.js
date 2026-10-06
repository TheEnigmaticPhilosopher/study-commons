import { escapeHTML as e, safeUrl } from './state.js';
import { accountCards, accountNav, accountCourseView } from './canvas-account.js';

export function formatCanvasDate(value, timeZone = 'UTC', dateOnly = false) {
  if (!value) return 'No date supplied';
  try { return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: dateOnly ? 'UTC' : timeZone }).format(new Date(value)); }
  catch { return 'Date unavailable'; }
}

export function createCanvasUi({ courses, onChange, notice }) {
  let session = null; let data = null; let error = ''; let busy = false; let generation = 0;
  let start = ''; let end = ''; let scenario = 'original';
  let pollTimer; let includeCompleted = true; let importPaused = false;
  const dateText = value => formatCanvasDate(value, data?.snapshot?.course.timeZone);
  const sourceLink = (url, label) => safeUrl(url) ? `<a href="${e(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a>` : e(label);
  function eventDates(event) {
    if (event.allDay) return formatCanvasDate(event.allDayDate || event.startAt, 'UTC', true);
    const first = dateText(event.startAt); const last = dateText(event.endAt);
    return event.endAt && last !== first ? `${first} – ${last}` : first;
  }
  async function api(path, body) {
    const current = generation;
    const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && current === generation) { session = { ...session, authenticated: false }; data = null; }
      throw new Error(result.error || 'Request failed.');
    }
    return result;
  }
  async function refresh() {
    const current = ++generation;
    clearTimeout(pollTimer);
    try {
      const nextSession = await api('session');
      if (current !== generation) return;
      const nextData = nextSession.authenticated ? await api('canvas') : null;
      if (current !== generation) return;
      session = nextSession; data = nextData; error = ''; importPaused = false;
    } catch {
      if (current !== generation) return;
      importPaused = Boolean(data?.serverlessSync && data?.accountJob?.running);
      error = 'The Canvas backend could not be reached. Your saved courses are still available; reload the connection to try again.';
    }
    onChange(); schedulePoll();
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    const current = generation;
    if (session?.authenticated && data?.accountJob?.running && !importPaused) pollTimer = setTimeout(async () => {
      if (current !== generation) return;
      try {
        if (data.serverlessSync) {
          const next = await api('canvas/sync-step', { jobId: data.accountJob.id });
          if (current !== generation) return;
          data = { ...data, accountJob: next.accountJob };
          if (!next.accountJob.running) {
            const finished = await api('canvas');
            if (current !== generation) return;
            data = finished;
          }
        } else {
          const next = await api('canvas');
          if (current !== generation) return;
          data = next;
        }
        error = ''; onChange(); schedulePoll();
      } catch (caught) {
        if (current !== generation) return;
        importPaused = Boolean(session?.authenticated && data?.serverlessSync);
        error = importPaused ? `Import paused: ${caught.message} Your saved courses are still available. Select Resume import to continue.` : caught.message;
        onChange();
      }
    }, 1500);
  }
  function accountControls() {
    const snapshot = data.account?.snapshot; const job = data.accountJob;
    if (job?.running && job.range) { start = job.range.start; end = job.range.end; includeCompleted = job.includeCompleted !== false; }
    if (!start) start = snapshot?.range.start || (data.mode === 'demo' ? '2027-03-01' : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    if (!end) end = snapshot?.range.end || (data.mode === 'demo' ? '2027-03-31' : new Date(Date.now() + 330 * 86400000).toISOString().slice(0, 10));
    return `<section class="canvas-panel"><div class="section-heading"><h2>${data.mode === 'demo' ? 'Fictional Canvas account' : 'Your Canvas account'}</h2><button data-canvas-action="logout" ${busy ? 'disabled' : ''}>Sign out</button></div>
      <p class="muted">${e(data.baseUrl)} · Courses appear automatically on your dashboard after syncing.</p>
      <p>Import modules, assignments, pages, file links, announcements, discussion topics, quizzes, and calendar events that your account can access.</p>
      ${data.serverlessSync ? '<p class="meta">Keep Study Commons open while importing. If you close it, reopen the Canvas connection to resume saved progress. Your original Canvas courses are imported directly into the dashboard.</p>' : ''}
      ${!data.accountReady ? `<p class="canvas-alert">Missing server settings: ${e(data.accountMissing.join(', '))}. Save them privately and restart the server.</p>` : ''}
      <form data-canvas-form="sync-all" class="form-grid"><label>Calendar start<input type="date" name="start" value="${e(start)}" ${busy || job?.running ? 'disabled' : ''} required></label><label>Calendar end<input type="date" name="end" value="${e(end)}" ${busy || job?.running ? 'disabled' : ''} required></label>
      <label class="full">Course scope<select name="scope" ${busy || job?.running ? 'disabled' : ''}><option value="all" ${includeCompleted ? 'selected' : ''}>Available and completed courses</option><option value="available" ${!includeCompleted ? 'selected' : ''}>Available courses only</option></select></label>
      <button class="primary full" ${busy || job?.running || !data.accountReady ? 'disabled' : ''}>${job?.running ? 'Syncing courses…' : 'Sync all Canvas courses'}</button></form>
      ${job?.running ? `<p class="canvas-progress" role="status">${job.total ? `${job.completed} of ${job.total} courses processed` : 'Discovering your courses…'}${job.currentCourse ? ` · ${e(job.currentCourse)}` : ''}</p>` : ''}
      ${importPaused ? `<button data-canvas-action="resume" ${busy ? 'disabled' : ''}>Resume import</button>` : ''}
      ${data.account?.lastError || job?.error ? `<p class="canvas-alert">${e(data.account.lastError || job.error)}</p>` : ''}
      ${snapshot ? `<p class="sync-status">Account scan finished ${e(new Date(snapshot.completedAt).toLocaleString())} · ${snapshot.courses.length} courses · ${snapshot.warnings} category warnings.</p><div class="actions"><a class="button" href="#dashboard">Open your linked courses</a></div>` : '<p class="sync-status">No account import saved yet.</p>'}
      <p class="meta">Read-only import. Calendar dates use this window; the other resource lists cover each course. Resource links open the original in Canvas. Hidden material and teacher-only content remain subject to your account’s permissions.</p></section>`;
  }
  function mappingForm(kind, item) {
    const current = data.mappings.find(mapping => mapping.kind === kind && mapping.sourceId === item.id);
    return `<form data-canvas-form="mapping" data-kind="${kind}" data-source="${e(item.id)}" class="mapping-form">
      <label>Study-hub unit for ${e(item.name || item.title)}<select name="target"><option value="">Unlinked</option>
      ${courses.filter(course => course.units.length).map(course => `<optgroup label="${e(course.name)}">${course.units.map(unit => `<option value="${e(JSON.stringify([course.id, unit.id]))}" ${current?.courseId === course.id && current?.unitId === unit.id ? 'selected' : ''}>${e(unit.title)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <button type="submit" ${busy ? 'disabled' : ''}>Save link</button></form>`;
  }
  function view() {
    const heading = '<div class="page-heading"><div><p class="eyebrow">Personal pilot</p><h1>Canvas connection</h1><p class="muted">Bring your course resources and schedule into the study hub.</p></div></div>';
    const alert = error ? `<p class="canvas-alert" role="alert">${e(error)}</p>` : '';
    if (!session) return heading + alert + '<p>Connecting to the backend…</p>';
    if (!session.authenticated) return heading + alert + `<section class="canvas-panel"><h2>Personal pilot sign-in</h2><p class="muted">Sign in with your study-hub personal pilot password to open your imported Canvas courses.</p>
      ${session.loginConfigured ? `<form data-canvas-form="login"><label>Personal pilot password<input type="password" name="password" autocomplete="current-password" required maxlength="512"></label><div class="actions"><button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Signing in…' : 'Sign in'}</button></div></form>` : '<p class="canvas-alert">Setup needed: configure a personal pilot password in the hosting provider’s server secrets, then restart or redeploy the app.</p>'}
      <p class="meta">Your Canvas access token belongs only in server secrets. Never enter it in this form.</p></section>`;
    if (!data) return heading + alert + '<button data-canvas-action="refresh">Reload connection</button>';
    const snapshot = data.snapshot;
    const accountPanel = accountControls();
    if (data.serverlessSync) return heading + alert + accountPanel;
    const year = new Date().getFullYear();
    if (!start) start = snapshot?.range.start || (data.mode === 'demo' ? '2027-03-01' : `${year}-01-01`);
    if (!end) end = snapshot?.range.end || (data.mode === 'demo' ? '2027-03-31' : `${year}-12-31`);
    return heading + alert + accountPanel + `<details class="library-examples"><summary>Optional: link a single Canvas course to the example library</summary><section class="canvas-panel"><div class="section-heading"><h2>${data.mode === 'demo' ? 'Fictional course · demo mode' : 'Your configured Canvas course'}</h2></div>
      <p>${data.mode === 'demo' ? 'This practice course uses sample data and makes no requests to your school.' : e(`${data.baseUrl} / course ${data.courseId}`)}</p>
      ${!data.ready ? `<p class="canvas-alert">Missing server settings: ${e(data.missing.join(', '))}. Add them privately and restart.</p>` : ''}
      <form data-canvas-form="sync" class="form-grid"><label>Calendar start<input type="date" name="start" value="${e(start)}" required></label><label>Calendar end<input type="date" name="end" value="${e(end)}" required></label>
      ${data.mode === 'demo' ? `<label class="full">Demo calendar scenario<select name="scenario"><option value="original" ${scenario === 'original' ? 'selected' : ''}>Unit 9: March 15–19, 2027</option><option value="rescheduled" ${scenario === 'rescheduled' ? 'selected' : ''}>Unit 9 moved to March 22–26, 2027</option></select></label>` : ''}
      <button class="primary full" ${busy || !data.ready ? 'disabled' : ''}>${busy ? 'Working…' : 'Sync now'}</button></form>
      <p class="meta">Read-only: syncing never changes Canvas. Only calendar events in this date range are included.</p>
      ${snapshot ? `<p class="sync-status">Last successful sync: ${e(new Date(snapshot.syncedAt).toLocaleString())} · ${snapshot.modules.length} modules · ${snapshot.events.length} calendar events</p>` : '<p class="sync-status">No successful sync yet.</p>'}
      ${data.lastError ? `<p class="canvas-alert">Last sync failed: ${e(data.lastError)} ${snapshot ? 'The previous snapshot is still shown.' : ''}</p>` : ''}</section>
      ${snapshot ? `<section class="canvas-panel"><h2>${e(snapshot.course.name)}</h2><p class="muted">${sourceLink(snapshot.course.url, 'Open in Canvas')} · Dates use ${e(snapshot.course.timeZone)}.</p>
      <h3>Link modules to your resource library</h3><p class="muted">Choose the matching study-hub unit. Links use Canvas IDs, so renaming a module keeps the connection.</p>
      ${snapshot.modules.length ? snapshot.modules.map(module => `<details class="canvas-record"><summary>${e(module.name)} <span class="meta">${module.items.length} items</span></summary>${mappingForm('module', module)}
        ${module.unlockAt ? `<p class="meta">Module opens: ${e(dateText(module.unlockAt))}. This is an availability date.</p>` : ''}
        <ul>${module.items.map(item => `<li>${sourceLink(item.url, item.title)} <span class="meta">${e(item.type)}${item.locked ? ' · Locked in Canvas' : ''}${item.dueAt ? ` · Due ${e(dateText(item.dueAt))}` : ''}</span></li>`).join('')}</ul></details>`).join('') : '<p class="empty-inline">No visible modules were returned by Canvas.</p>'}
      <h3>Link teaching events</h3><p class="muted">Only link an event if it represents teaching time for that unit. Canvas deadlines and module availability do not establish a teaching week.</p>
      ${snapshot.events.length ? snapshot.events.map(event => `<article class="canvas-record"><h4>${sourceLink(event.url, event.title)}</h4><p>${e(eventDates(event))}</p>${mappingForm('event', event)}</article>`).join('') : '<p class="empty-inline">No course calendar events in this range. Try different dates, or ask your teacher to add a lesson event. Dates cannot be inferred from an empty calendar.</p>'}</section>` : ''}</details>`;
  }
  function unitView(courseId, unitId) {
    if (!session?.authenticated || !data?.snapshot) return '';
    const snapshot = data.snapshot;
    const mappings = data.mappings.filter(item => item.courseId === courseId && item.unitId === unitId);
    const events = snapshot.events.filter(event => mappings.some(item => item.kind === 'event' && item.sourceId === event.id));
    const modules = snapshot.modules.filter(module => mappings.some(item => item.kind === 'module' && item.sourceId === module.id));
    if (!events.length && !modules.length) return '';
    return `<section class="canvas-unit"><p class="eyebrow">${data.mode === 'demo' ? 'Fictional Canvas demo' : 'Private Canvas connection'} · ${e(snapshot.course.name)}</p>
      ${events.map(event => `<p class="teaching-date"><strong>Scheduled teaching: ${e(eventDates(event))}</strong><br>${sourceLink(event.url, event.title)}</p>`).join('')}
      ${!events.length ? '<p class="meta">No teaching event linked for this date range.</p>' : ''}
      ${modules.flatMap(module => module.items).map(item => `<p class="canvas-resource">${sourceLink(item.url, item.title)} <span class="meta">${item.locked ? 'Locked in Canvas' : e(item.type)}${item.dueAt ? ` · Due ${e(dateText(item.dueAt))}` : ''}</span></p>`).join('')}
      <p class="meta">${data.lastError ? 'Last sync failed; showing saved data. ' : ''}Synced ${e(new Date(snapshot.syncedAt).toLocaleString())}. <a href="#canvas">Manage connection</a></p></section>`;
  }
  function resourceCount(courseId, unitId) {
    if (!session?.authenticated || !data?.snapshot) return 0;
    const ids = data.mappings.filter(item => item.kind === 'module' && item.courseId === courseId && item.unitId === unitId).map(item => item.sourceId);
    return data.snapshot.modules.filter(module => ids.includes(module.id)).reduce((total, module) => total + module.items.length, 0);
  }
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.dataset.canvasForm) return;
    event.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(form));
    const action = form.dataset.canvasForm;
    const kind = form.dataset.kind; const sourceId = form.dataset.source;
    const canvasCourseId = form.dataset.course; const eventId = form.dataset.event;
    if (action === 'sync' || action === 'sync-all') { start = values.start; end = values.end; scenario = values.scenario || 'original'; }
    if (action === 'sync-all') includeCompleted = values.scope === 'all';
    busy = true; error = ''; onChange();
    const submissionGeneration = generation;
    try {
      if (action === 'login') {
        await api('login', { password: values.password });
        await refresh();
        if (session?.authenticated && data?.account?.snapshot) location.hash = '#dashboard';
        notice('Signed in to your personal pilot.');
      } else if (action === 'sync') {
        data = await api('canvas/sync', { start, end, scenario }); notice('Canvas snapshot saved.');
      } else if (action === 'sync-all') {
        data = await api('canvas/sync-all', { start, end, includeCompleted }); importPaused = false; schedulePoll(); notice('Canvas course import started.');
      } else if (action === 'grades') {
        const result = await api('canvas/grades', { courseId: canvasCourseId });
        if (submissionGeneration !== generation || !session?.authenticated || !data) return;
        data = { ...data, grades: { ...data.grades, [result.courseId]: result.grades } };
        notice('Sample grades reset. Your real Canvas grades are not imported.');
      } else if (action === 'course-mapping') {
        data = await api('canvas/course-mapping', { courseId: canvasCourseId, eventId, moduleId: values.moduleId }); notice('Teaching event linked to its Canvas module.');
      } else if (action === 'mapping') {
        const [courseId, unitId] = values.target ? JSON.parse(values.target) : ['', ''];
        data = await api('canvas/mapping', { kind, sourceId, courseId, unitId }); notice('Unit link saved. Open that course to see it.');
      }
    } catch (caught) {
      error = caught.message;
      if (action === 'grades') notice(`Sample grade reset failed: ${caught.message} Your class materials are unchanged.`);
      if (['sync', 'sync-all'].includes(action) && session?.authenticated) { try { data = await api('canvas'); schedulePoll(); } catch { data = null; } }
    } finally { busy = false; onChange(); }
  });
  document.addEventListener('click', async event => {
    const action = event.target.closest('[data-canvas-action]')?.dataset.canvasAction;
    if (!action || busy) return;
    if (action === 'refresh' || action === 'resume') { await refresh(); return; }
    if (action === 'logout') {
      busy = true; ++generation; clearTimeout(pollTimer);
      try {
        await api('logout', {});
        // A page restore may have started another refresh while logout was pending.
        ++generation; clearTimeout(pollTimer);
        data = null; session = { ...session, authenticated: false }; error = ''; importPaused = false;
      }
      catch (caught) { error = caught.message; }
      finally { busy = false; onChange(); schedulePoll(); }
    }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  function linkedCourseView(name) {
    if (!session?.authenticated) return '';
    const matches = data?.account?.snapshot?.courses.filter(item => item.course.name.trim() === name.trim()) || [];
    if (!matches.length) return '';
    return `<section class="canvas-panel"><h2>Your real class materials</h2><p>These are the original imported Canvas courses. Grades in Study Commons are fictional demo values.</p><ul class="canvas-resource-list">${matches.map(item => `<li><a href="#canvas-course/${encodeURIComponent(item.course.id)}/modules">${e(item.course.name)} · ${e(item.course.term || 'Canvas course')}</a><p class="meta">${item.modules.length} modules · ${item.assignments.length} assignments · ${item.files.length} files</p></li>`).join('')}</ul></section>`;
  }
  return { view, unitView, resourceCount, refresh, hasAccount: () => Boolean(data?.account?.snapshot),
    linkedCourseView,
    dashboardView: () => accountCards(data), navView: () => accountNav(data), courseView: (id, section) => accountCourseView(data, id, section, busy) };
}
