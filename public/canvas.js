import { escapeHTML as e, safeUrl } from './state.js';

export function formatCanvasDate(value, timeZone = 'UTC', dateOnly = false) {
  if (!value) return 'No date supplied';
  try { return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: dateOnly ? 'UTC' : timeZone }).format(new Date(value)); }
  catch { return 'Date unavailable'; }
}

export function createCanvasUi({ courses, onChange, notice }) {
  let session = null; let data = null; let error = ''; let busy = false; let generation = 0;
  let start = ''; let end = ''; let scenario = 'original';
  const dateText = value => formatCanvasDate(value, data?.snapshot?.course.timeZone);
  const sourceLink = (url, label) => safeUrl(url) ? `<a href="${e(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a>` : e(label);
  function eventDates(event) {
    if (event.allDay) return formatCanvasDate(event.allDayDate || event.startAt, 'UTC', true);
    const first = dateText(event.startAt); const last = dateText(event.endAt);
    return event.endAt && last !== first ? `${first} – ${last}` : first;
  }
  async function api(path, body) {
    const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { session = { ...session, authenticated: false }; data = null; }
      throw new Error(result.error || 'Request failed.');
    }
    return result;
  }
  async function refresh() {
    const current = ++generation;
    try {
      const nextSession = await api('session');
      const nextData = nextSession.authenticated ? await api('canvas') : null;
      if (current !== generation) return;
      session = nextSession; data = nextData; error = '';
    } catch { if (current !== generation) return; data = null; error = 'The Canvas backend is unavailable. Start the Node server and reload.'; }
    onChange();
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
    if (!session.authenticated) return heading + alert + `<section class="canvas-panel"><h2>Private demo sign-in</h2><p class="muted">Synced course content is visible only after signing in. Use your study-hub demo password here.</p>
      ${session.loginConfigured ? `<form data-canvas-form="login"><label>Demo password<input type="password" name="password" autocomplete="current-password" required maxlength="512"></label><div class="actions"><button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Signing in…' : 'Sign in'}</button></div></form>` : '<p class="canvas-alert">Setup needed: set HUB_ADMIN_PASSWORD (at least 16 characters) in your server’s .env file or Replit Secrets, then restart the server.</p>'}
      <p class="meta">Your Canvas access token belongs only in server secrets. Never enter it in this form.</p></section>`;
    if (!data) return heading + alert + '<button data-canvas-action="refresh">Reload connection</button>';
    const snapshot = data.snapshot;
    const year = new Date().getFullYear();
    if (!start) start = snapshot?.range.start || (data.mode === 'demo' ? '2027-03-01' : `${year}-01-01`);
    if (!end) end = snapshot?.range.end || (data.mode === 'demo' ? '2027-03-31' : `${year}-12-31`);
    return heading + alert + `<section class="canvas-panel"><div class="section-heading"><h2>${data.mode === 'demo' ? 'Fictional course · demo mode' : 'Your Canvas course'}</h2><button data-canvas-action="logout" ${busy ? 'disabled' : ''}>Sign out</button></div>
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
      ${snapshot.events.length ? snapshot.events.map(event => `<article class="canvas-record"><h4>${sourceLink(event.url, event.title)}</h4><p>${e(eventDates(event))}</p>${mappingForm('event', event)}</article>`).join('') : '<p class="empty-inline">No course calendar events in this range. Try different dates, or ask your teacher to add a lesson event. Dates cannot be inferred from an empty calendar.</p>'}</section>` : ''}`;
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
    if (action === 'sync') { start = values.start; end = values.end; scenario = values.scenario || 'original'; }
    busy = true; error = ''; onChange();
    try {
      if (action === 'login') {
        await api('login', { password: values.password });
        await refresh(); notice('Signed in to the private Canvas demo.');
      } else if (action === 'sync') {
        data = await api('canvas/sync', { start, end, scenario }); notice('Canvas snapshot saved.');
      } else if (action === 'mapping') {
        const [courseId, unitId] = values.target ? JSON.parse(values.target) : ['', ''];
        data = await api('canvas/mapping', { kind, sourceId, courseId, unitId }); notice('Unit link saved. Open that course to see it.');
      }
    } catch (caught) {
      error = caught.message;
      if (action === 'sync' && session?.authenticated) { try { data = await api('canvas'); } catch { data = null; } }
    } finally { busy = false; onChange(); }
  });
  document.addEventListener('click', async event => {
    const action = event.target.closest('[data-canvas-action]')?.dataset.canvasAction;
    if (!action || busy) return;
    if (action === 'refresh') { await refresh(); return; }
    if (action === 'logout') {
      busy = true;
      try { await api('logout', {}); ++generation; data = null; session = { ...session, authenticated: false }; error = ''; }
      catch (caught) { error = caught.message; }
      finally { busy = false; onChange(); }
    }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  return { view, unitView, resourceCount, refresh };
}
