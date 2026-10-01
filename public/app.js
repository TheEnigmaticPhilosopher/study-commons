import { school, courses } from './data.js';
import { createInitialState, loadState, saveState, safeUrl, parseRoute, escapeHTML as e } from './state.js';
import { createCanvasUi } from './canvas.js';
import { pastPapersView } from './study.js';

let storage;
try { storage = window.localStorage; } catch { storage = null; }
let state = storage ? loadState(storage, courses, school) : createInitialState(courses, school);
let catalogQuery = '';
let expandedQuestionId = '';
let noticeTimer;
const main = document.getElementById('main');
const navigation = document.getElementById('navigation');
const canvas = createCanvasUi({ courses, onChange: render, notice });
document.getElementById('school-name').textContent = school.name;
document.title = `${school.name} · Study Commons`;

function notice(message) {
  const status = document.getElementById('status');
  clearTimeout(noticeTimer);
  status.textContent = message;
  status.hidden = false;
  noticeTimer = setTimeout(() => { status.hidden = true; }, 6500);
}

function persist(message) {
  notice(saveState(storage, school.storageKey, state) ? message : 'Browser storage is unavailable. Changes will last only until this page closes.');
}

function route() {
  return parseRoute(location.hash, courses);
}

function link(url, title, className = '') {
  const valid = safeUrl(url);
  return valid ? `<a class="${className}" href="${e(valid)}" target="_blank" rel="noopener noreferrer">${e(title)} <span aria-hidden="true">↗</span></a>` : `<span>${e(title)} (link unavailable)</span>`;
}

function courseHref(course, section = 'resources') { return `#course/${course.id}/${section}`; }
function unitTitle(course, unitId) { return course.units.find(unit => unit.id === unitId)?.title || 'General'; }
function topicOptions(course) { return `<option value="">General course question</option>${course.units.map(unit => `<option value="${e(unit.id)}">${e(unit.title)}</option>`).join('')}`; }

function courseCard(course, catalog = false) {
  const joined = state.joined.includes(course.id);
  return `<article class="course-card">
    <div class="course-band"><span class="course-monogram" aria-hidden="true">${e(course.shortName)}</span><span>${e(course.department)}</span></div>
    <div class="course-content"><h2><a href="${courseHref(course)}">${e(course.name)}</a></h2><p class="muted">${e(course.description)}</p>
    <p class="course-meta">${course.resources.length} public resource ${course.resources.length === 1 ? 'link' : 'links'} · ${course.units.length} library ${course.units.length === 1 ? 'section' : 'sections'}</p>
    <div class="actions"><a class="button" href="${courseHref(course)}">Open course</a>
    ${catalog ? `<button type="button" class="${joined ? 'subtle' : 'primary'}" data-action="join" data-course="${e(course.id)}" aria-pressed="${joined}">${joined ? 'Remove from dashboard' : '+ Add to dashboard'}</button>` : `<a href="${courseHref(course, 'discussions')}">Discussions</a>`}</div></div>
  </article>`;
}

function courseHeader(course, section) {
  const joined = state.joined.includes(course.id);
  return `<div class="page-heading"><div><p class="eyebrow">School resource library / ${e(course.department)}</p><h1>${e(course.name)}</h1></div>
    <button type="button" class="subtle" data-action="join" data-course="${e(course.id)}" aria-pressed="${joined}">${joined ? 'Remove from dashboard' : '+ Add to dashboard'}</button></div>
    <nav class="course-tabs" aria-label="Course sections"><a href="${courseHref(course)}" ${section !== 'discussions' ? 'aria-current="page"' : ''}>Resources</a><a href="${courseHref(course, 'discussions')}" ${section === 'discussions' ? 'aria-current="page"' : ''}>Discussions</a></nav>`;
}

function resourcesView(course) {
  const suggestions = state.suggestions.filter(suggestion => suggestion.courseId === course.id);
  return `${pastPapersView(course.name)}<div class="resource-links">${course.links.map(item => link(item.url, item.title)).join('')}</div>
    ${course.units.length ? `<div class="units">${course.units.map((unit, index) => {
      const resources = course.resources.filter(resource => resource.unitId === unit.id && resource.type !== 'Past exam');
      const resourceCount = resources.length + canvas.resourceCount(course.id, unit.id);
      return `<details class="unit" ${index === 0 ? 'open' : ''}><summary>${e(unit.title)}<span class="count">${resourceCount} ${resourceCount === 1 ? 'resource' : 'resources'}</span></summary>
        <div class="unit-content">${canvas.unitView(course.id, unit.id)}${resources.length ? resources.map(resource => resource.url
          ? `<div class="resource">${link(resource.url, resource.title)}<p class="meta">${e(resource.type)} · ${e(resource.source)}</p></div>`
          : `<details class="resource"><summary>${e(resource.title)}</summary><p class="meta">${e(resource.type)} · ${e(resource.source)}</p><p class="prose">${e(resource.text)}</p></details>`).join('')
          : resourceCount ? '' : '<p class="empty-inline">No resources here yet.</p>'}
          <a class="unit-question" href="${courseHref(course, 'discussions')}" data-action="ask-unit" data-unit="${e(unit.id)}">Ask about this topic</a>
        </div></details>`;
    }).join('')}</div>` : '<div class="empty"><h2>Course outline coming soon</h2><p>The resource library is being organized. You can still use the discussion board.</p></div>'}
    <details class="suggestion-panel"><summary>Suggest a resource</summary><p class="muted">Suggestions are marked pending in this demo. A shared review workflow can be connected later.</p>
      <form data-form="suggestion" class="form-grid"><label class="full">Resource title<input name="title" maxlength="120" required></label><label>Module<select name="unitId"><option value="">Course-wide resource</option>${course.units.map(unit => `<option value="${e(unit.id)}">${e(unit.title)}</option>`).join('')}</select></label>
      <label>Type<select name="type"><option>Notes</option><option>Practice</option><option>Video</option><option>Open reading</option></select></label>
      <label class="full">Resource URL<input name="url" type="url" placeholder="https://…" required></label><label class="full">Creator or source<input name="source" maxlength="120" required></label>
      <button class="button full" type="submit">Save suggestion</button></form>
    </details>
    ${suggestions.length ? `<section class="suggestions"><h2>Your resource suggestions</h2>${suggestions.map(item => `<div class="suggestion">${link(item.url, item.title)}<p class="meta">${e(unitTitle(course, item.unitId))} · ${e(item.source)}</p><span class="badge">Pending · local demo</span></div>`).join('')}</section>` : ''}`;
}

function questionView(course, question, index) {
  const replies = question.replies;
  const status = question.answered ? 'Answered' : replies.length ? 'Open' : 'Unanswered';
  const open = expandedQuestionId ? question.id === expandedQuestionId : index === 0;
  return `<details class="thread" data-question-id="${e(question.id)}" ${open ? 'open' : ''}><summary><span class="thread-title">${e(question.title)}</span><span class="thread-meta">${e(unitTitle(course, question.unitId))} · ${e(question.author)} · ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'} <span class="badge">${status}</span></span></summary>
    <div class="thread-content"><p class="prose question-body">${e(question.body)}</p>
    ${replies.map(reply => `<article class="reply"><p class="meta">${e(reply.author)}</p><p class="prose">${e(reply.body)}</p></article>`).join('')}
    <form data-form="reply" data-question="${e(question.id)}"><label>Your reply<textarea name="body" rows="3" maxlength="3000" placeholder="Add an explanation or a follow-up question" required></textarea></label><div class="actions"><button type="submit">Post reply</button>${question.mine ? `<button type="button" class="subtle" data-action="answered" data-question="${e(question.id)}">${question.answered ? 'Reopen question' : 'Mark answered'}</button>` : ''}</div></form></div></details>`;
}

function discussionsView(course) {
  const questions = state.questions[course.id] || [];
  return `<div class="section-heading"><h2>Course discussions</h2><button type="button" class="primary" data-action="ask">+ Ask a question</button></div>
    <form id="question-form" data-form="question" class="question-form" hidden><h2>New question</h2><div class="form-grid">
      <label class="full">Question<input name="title" maxlength="160" placeholder="What are you working through?" required></label>
      <label class="full">Topic<select name="unitId">${topicOptions(course)}</select></label>
      <label class="full">Details<textarea name="body" rows="4" maxlength="3000" placeholder="Share what you've tried and where you're stuck." required></textarea></label></div>
      <div class="actions"><button type="submit" class="primary">Post question</button><button type="button" data-action="cancel-question">Cancel</button></div></form>
    ${questions.length ? questions.map((question, index) => questionView(course, question, index)).join('') : '<div class="empty"><h2>No questions yet</h2><p>Start a discussion about something you’re learning.</p></div>'}`;
}

function render() {
  const { page, course, section } = route();
  navigation.innerHTML = `<a href="#dashboard" ${page === 'dashboard' ? 'aria-current="page"' : ''}>Dashboard</a><a href="#canvas" ${page === 'canvas' ? 'aria-current="page"' : ''}>Canvas connection</a>${canvas.navView()}<p class="nav-label">School resource library</p><a href="#catalog" ${page === 'catalog' ? 'aria-current="page"' : ''}>School course catalog</a><p class="nav-label">My public library</p>${state.joined.map(id => courses.find(item => item.id === id)).filter(Boolean).map(item => `<a href="${courseHref(item)}" ${course?.id === item.id ? 'aria-current="page"' : ''}>${e(item.name)}</a>`).join('')}`;
  if (page === 'dashboard') {
    const joined = courses.filter(item => state.joined.includes(item.id));
    main.innerHTML = `<div class="page-heading"><div><p class="eyebrow">${e(school.name)}</p><h1>School resource library</h1><p class="muted">Public resources curated for courses from your school’s Canvas pilot. <a href="#canvas">Open your private Canvas connection</a> to view or import your courses.</p></div><a class="button primary" href="#catalog">+ Add a course</a></div>${joined.length ? `<div class="course-grid">${joined.map(item => courseCard(item)).join('')}</div>` : '<div class="empty"><h2>Choose your courses</h2><p>Add school courses to your dashboard for quick access to free study resources.</p><a class="button" href="#catalog">Browse school courses</a></div>'}`;
  } else if (page === 'catalog') {
    main.innerHTML = `<div class="page-heading"><div><p class="eyebrow">${e(school.name)}</p><h1>School course catalog</h1><p class="muted">46 course names from the Canvas pilot, including historical sections and summer work. This is a student-built library, not an official current course catalog.</p></div></div><form data-form="catalog-search" class="mapping-form"><label>Find a course<input name="query" type="search" value="${e(catalogQuery)}" placeholder="Calculus, Latin, chemistry…"></label><button>Search</button></form><p class="meta">${courses.filter(item => item.name.toLowerCase().includes(catalogQuery.toLowerCase())).length} matching courses · Free access does not always mean public domain. Licensing notes appear with each link.</p><div class="course-grid">${courses.filter(item => item.name.toLowerCase().includes(catalogQuery.toLowerCase())).map(item => courseCard(item, true)).join('')}</div>`;
  } else if (page === 'course' && course) {
    main.innerHTML = courseHeader(course, section) + (section === 'discussions' ? discussionsView(course) : resourcesView(course));
  } else if (page === 'canvas') {
    main.innerHTML = canvas.view();
  } else if (page === 'canvas-course') {
    const [, courseId, canvasSection] = location.hash.slice(1).split('/');
    main.innerHTML = canvas.courseView(courseId, canvasSection);
  } else {
    main.innerHTML = '<div class="empty"><h1>Page not found</h1><a class="button" href="#dashboard">Back to dashboard</a></div>';
  }
  if (page === 'dashboard' && canvas.hasAccount()) {
    const examples = main.innerHTML;
    main.innerHTML = `<div class="page-heading"><div><h1>${page === 'dashboard' ? 'Your dashboard' : 'Your course resources'}</h1><p class="muted">Courses and materials linked to your private Canvas connection.</p></div></div>` + canvas.dashboardView() + `<details class="library-examples"><summary>School resource library</summary>${examples}</details>`;
  }
}

function openQuestionForm(unitId = '') {
  const form = document.getElementById('question-form');
  if (!form) return;
  form.hidden = false;
  form.elements.unitId.value = unitId;
  form.elements.title.focus();
}

document.addEventListener('submit', event => {
  if (event.target.dataset.form !== 'catalog-search') return;
  event.preventDefault(); catalogQuery = String(new FormData(event.target).get('query') || '').trim(); render();
});

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'skip') { event.preventDefault(); main.focus(); return; }
  const { course } = route();
  if (button.dataset.action === 'join') {
    const id = button.dataset.course;
    if (!courses.some(item => item.id === id)) return;
    const joined = state.joined.includes(id);
    state.joined = joined ? state.joined.filter(item => item !== id) : [...state.joined, id];
    render(); persist(joined ? 'Course removed from your dashboard.' : 'Course added to your dashboard.');
  } else if (button.dataset.action === 'ask') {
    openQuestionForm();
  } else if (button.dataset.action === 'ask-unit' && course) {
    event.preventDefault();
    pendingUnit = button.dataset.unit;
    location.hash = courseHref(course, 'discussions');
  } else if (button.dataset.action === 'cancel-question') {
    document.getElementById('question-form').hidden = true;
  } else if (button.dataset.action === 'answered' && course) {
    const question = state.questions[course.id].find(item => item.id === button.dataset.question);
    if (!question?.mine) return;
    question.answered = !question.answered; expandedQuestionId = question.id;
    render(); persist(question.answered ? 'Question marked answered.' : 'Question reopened.');
  }
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const { course } = route();
  if (!course) return;
  const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value).trim()]));
  for (const input of form.querySelectorAll('[required]')) {
    input.setCustomValidity(values[input.name] ? '' : 'Please enter a value.');
    if (!input.reportValidity()) return;
  }
  if (form.dataset.form === 'question') {
    const question = { id: crypto.randomUUID(), title: values.title, body: values.body, unitId: values.unitId, author: 'You', mine: true, answered: false, replies: [] };
    state.questions[course.id].unshift(question); expandedQuestionId = question.id;
    render(); persist('Question saved in this browser.');
  } else if (form.dataset.form === 'reply') {
    const question = state.questions[course.id].find(item => item.id === form.dataset.question);
    if (!question) return;
    question.replies.push({ author: 'You', body: values.body }); expandedQuestionId = question.id;
    render(); persist('Reply saved in this browser.');
  } else if (form.dataset.form === 'suggestion') {
    const url = safeUrl(values.url);
    if (!url) { form.elements.url.setCustomValidity('Use an http:// or https:// URL.'); form.elements.url.reportValidity(); return; }
    state.suggestions.unshift({ id: crypto.randomUUID(), courseId: course.id, ...values, url });
    render(); persist('Resource suggestion saved as pending in this browser.');
  }
});

document.addEventListener('input', event => { if (event.target.setCustomValidity) event.target.setCustomValidity(''); });
let pendingUnit = null;
window.addEventListener('hashchange', () => {
  expandedQuestionId = '';
  render();
  window.scrollTo(0, 0);
  if (pendingUnit !== null) { openQuestionForm(pendingUnit); pendingUnit = null; }
});
render();
canvas.refresh();
