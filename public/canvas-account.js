import { escapeHTML as e, safeUrl } from './state.js';
import { gradesView, gradeLabel, publicResourcesView } from './study.js';

const link = (url, title) => safeUrl(url) ? `<a href="${e(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${e(title)} ↗</a>` : e(title);
const href = (id, section = 'modules') => `#canvas-course/${encodeURIComponent(id)}/${section}`;
const labels = { grades: 'Grades & study plan', resources: 'Public resources', modules: 'Modules', assignments: 'Assignments', pages: 'Pages', files: 'Files', announcements: 'Announcements', discussions: 'Discussions', quizzes: 'Quizzes', events: 'Calendar' };
function format(value, zone = 'UTC', allDay = false) {
  if (!value) return 'No date supplied';
  try { return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: allDay ? 'UTC' : zone }).format(new Date(value)); }
  catch { return 'Date unavailable'; }
}
function eventDate(event, zone) {
  if (event.allDay) return format(event.allDayDate || event.startAt, 'UTC', true);
  const first = format(event.startAt, zone); const last = format(event.endAt, zone);
  return event.endAt && first !== last ? `${first} – ${last}` : first;
}
export function accountNav(data) {
  const courses = data?.account?.snapshot?.courses;
  return courses ? `<details class="private-course-nav"><summary>Private Canvas courses (${courses.length})</summary>${courses.map(item => `<a href="${href(item.course.id)}">${e(item.course.name)}</a>`).join('')}</details>` : '';
}
export function accountCards(data) {
  const snapshot = data?.account?.snapshot;
  if (!snapshot) return '';
  return `<section class="imported-courses"><div class="section-heading"><h2>${data.mode === 'demo' ? 'Fictional Canvas courses' : 'Your Canvas courses'}</h2><a href="#canvas">Sync and connection</a></div>
    ${data.account.lastError ? `<p class="canvas-alert">Last sync failed: ${e(data.account.lastError)} Showing saved course data.</p>` : ''}
    ${snapshot.courses.length ? `<div class="course-grid">${snapshot.courses.map(item => `<article class="course-card"><div class="course-band"><span class="course-monogram">${e(item.course.code || 'Canvas')}</span><span>${e(item.course.term || item.course.state)}</span></div>
      <div class="course-content"><h2><a href="${href(item.course.id)}">${e(item.course.name)}</a></h2><p class="muted">Linked directly to Canvas course ${e(item.course.id)}.</p>
      <p class="course-meta">${item.modules.length} modules · ${item.assignments.length} assignments · ${item.files.length} files</p>
      <p><a href="${href(item.course.id, 'grades')}">${e(gradeLabel(data.grades?.[item.course.id]))} · Study plan</a></p>
      ${item.warnings.length ? '<p class="canvas-alert">Some categories could not be refreshed. Open the course for details.</p>' : ''}
      <div class="actions"><a class="button primary" href="${href(item.course.id)}">Open resources</a>${link(item.course.url, 'Canvas')}</div></div></article>`).join('')}</div>` : '<p class="empty">Canvas returned no available courses for the selected scope.</p>'}</section>`;
}
export function accountCourseView(data, courseId, section = 'modules', busy = false) {
  const record = data?.account?.snapshot?.courses.find(item => item.course.id === courseId);
  if (!record) return '<div class="empty"><h1>Canvas course unavailable</h1><p>Sign in and sync your courses to open their private resources.</p><a class="button" href="#canvas">Canvas connection</a></div>';
  const course = record.course;
  if (!Object.hasOwn(labels, section)) section = 'modules';
  const status = record.collections[section];
  const resource = item => `<li class="canvas-resource">${link(item.url, item.title)}<p class="meta">${e(item.type)}${item.locked ? ' · Locked in Canvas' : ''}${item.dueAt ? ` · Due ${e(format(item.dueAt, course.timeZone))}` : ''}${item.unlockAt ? ` · Opens ${e(format(item.unlockAt, course.timeZone))}` : ''}</p></li>`;
  let body;
  if (section === 'grades') body = gradesView(record, data.grades?.[courseId], busy);
  else if (section === 'resources') body = publicResourcesView(course.name);
  else if (section === 'modules') {
    body = record.modules.length ? `<div class="units">${record.modules.map((module, index) => {
      const mapped = data.account.mappings.filter(item => item.courseId === courseId && item.moduleId === module.id).map(item => item.eventId);
      const events = record.events.filter(event => mapped.includes(event.id));
      return `<details class="unit" ${index === 0 ? 'open' : ''}><summary>${e(module.name)}<span class="count">${module.items.length} items</span></summary><div class="unit-content">
        ${events.map(event => `<p class="teaching-date"><strong>Scheduled teaching: ${e(eventDate(event, course.timeZone))}</strong><br>${link(event.url, event.title)}${record.collections.events?.status !== 'synced' ? '<br><span class="meta">Saved calendar data; last refresh failed.</span>' : ''}</p>`).join('')}
        ${module.unlockAt ? `<p class="meta">Module availability: ${e(format(module.unlockAt, course.timeZone))}</p>` : ''}
        ${module.items.length ? `<ul class="canvas-resource-list">${module.items.map(resource).join('')}</ul>` : '<p class="empty-inline">No items in this Canvas module.</p>'}
        </div></details>`;
    }).join('')}</div>` : '<p class="empty">No modules were returned. Check the other resource tabs for course material.</p>';
  } else if (section === 'events') {
    body = `<p class="muted">Calendar window: ${e(record.range.start)} to ${e(record.range.end)}. Link an event to a module only if it represents teaching time.</p>` + record.events.map(event => {
      const selected = data.account.mappings.find(item => item.courseId === courseId && item.eventId === event.id)?.moduleId;
      return `<article class="canvas-record"><h2>${link(event.url, event.title)}</h2><p>${e(eventDate(event, course.timeZone))}</p>
        <form data-canvas-form="course-mapping" data-course="${e(courseId)}" data-event="${e(event.id)}" class="mapping-form"><label>Teaching module for ${e(event.title)}<select name="moduleId"><option value="">Not linked as teaching time</option>${record.modules.map(module => `<option value="${e(module.id)}" ${selected === module.id ? 'selected' : ''}>${e(module.name)}</option>`).join('')}</select></label><button ${busy ? 'disabled' : ''}>Save teaching link</button></form></article>`;
    }).join('') + (!record.events.length ? '<p class="empty">No course events in this date window.</p>' : '');
  } else {
    body = record[section].length ? `<ul class="canvas-resource-list">${record[section].map(resource).join('')}</ul>` : '<p class="empty">No accessible items returned in this category.</p>';
    if (section === 'quizzes') body += '<p class="meta">This tab lists Classic Quizzes. New Quizzes and external activities also appear through Assignments or Modules when Canvas exposes them there.</p>';
  }
  return `<div class="page-heading"><div><p class="eyebrow">${data.mode === 'demo' ? 'Fictional Canvas demo' : 'Private Canvas course'} · ${e(course.term)}</p><h1>${e(course.name)}</h1><p class="muted">${link(course.url, 'Open course in Canvas')} · ${link(course.syllabusUrl, 'Syllabus')} · ${e(course.timeZone)}</p></div><a class="button" href="#canvas">Sync settings</a></div>
    <p class="meta">Last complete course sync: ${record.syncedAt ? e(new Date(record.syncedAt).toLocaleString()) : 'Not yet complete'}.</p>
    ${data.account.lastError ? `<p class="canvas-alert">Account sync failed: ${e(data.account.lastError)}. Showing saved content.</p>` : ''}
    ${record.warnings.length ? `<details class="canvas-alert"><summary>Some content could not be refreshed (${record.warnings.length} categories)</summary><ul>${record.warnings.map(warning => `<li>${e(warning)}</li>`).join('')}</ul></details>` : ''}
    <nav class="course-tabs canvas-tabs" aria-label="Canvas course sections">${Object.entries(labels).map(([key, label]) => `<a href="${href(courseId, key)}" ${section === key ? 'aria-current="page"' : ''}>${label}${Array.isArray(record[key]) ? ` (${record[key].length})` : ''}</a>`).join('')}</nav>
    ${['grades', 'resources'].includes(section) ? '' : status?.status !== 'synced' ? `<p class="canvas-alert">${e(labels[section])}: ${e(status?.error || 'Not refreshed yet')}${status?.syncedAt ? ` Saved data from ${e(new Date(status.syncedAt).toLocaleString())} is shown.` : ''}</p>` : `<p class="meta">Refreshed ${e(new Date(status.syncedAt).toLocaleString())}. Links open the original material in Canvas.</p>`}
    ${body}`;
}
