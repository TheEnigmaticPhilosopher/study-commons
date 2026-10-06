import { escapeHTML as e, safeUrl } from './state.js';
import { topics, resourcesFor, subjectFor, courseSlug } from './library.js';
import { courseNames } from './course-names.js';
const link = (url, label) => safeUrl(url) ? `<a href="${e(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a>` : e(label);
const percent = value => typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 10) / 10}%` : 'Not provided';
export function gradeLabel(grades) {
  if (!grades?.isDemo) return 'Sample grade not available';
  return `Sample ${percent(grades.currentScore)}${grades.currentGrade ? ` · ${grades.currentGrade}` : ''}`;
}
export function studyPriorities(name, grades) {
  const available = topics.filter(topic => topic.subject === subjectFor(name));
  const assignments = ['synced', 'demo'].includes(grades?.status) ? grades.assignments || [] : [];
  return available.map(topic => {
    // A multi-topic assignment cannot isolate which skill caused a low score.
    const evidence = assignments.filter(item => !item.missing && !item.late && !item.excused && !item.excluded && item.currentAttempt !== false &&
      item.postedAt && typeof item.score === 'number' && Number.isFinite(item.score) && item.pointsPossible > 0 &&
      available.filter(candidate => candidate.match.test(item.title)).length === 1 && topic.match.test(item.title))
      .sort((a, b) => Date.parse(b.gradedAt || b.postedAt) - Date.parse(a.gradedAt || a.postedAt)).slice(0, 5);
    const average = evidence.length ? evidence.reduce((sum, item) => sum + item.score / item.pointsPossible * 100, 0) / evidence.length : null;
    return { ...topic, evidence, average, review: average !== null && average < 80,
      practiceCount: average !== null && average < 80 ? 6 : 2 };
  }).sort((a, b) => Number(b.review) - Number(a.review) || (a.average ?? 101) - (b.average ?? 101));
}
// Original practice written for this pilot; not copied AP or textbook questions.
export function relatedRatesProblems(count = 2) {
  return [
    { question: 'A circle’s radius grows at 3 cm/s. How quickly does its area grow when the radius is 4 cm?', answer: '24π cm²/s. Differentiate A = πr²: dA/dt = 2πr(dr/dt) = 2π(4)(3).' },
    { question: 'A 13 m ladder leans against a wall. Its foot moves away at 2 m/s. How quickly does the top move when the foot is 5 m from the wall?', answer: '−5/6 m/s (downward). At x = 5, y = 12. From x² + y² = 169, dy/dt = −(x/y) dx/dt = −(5/12)(2).' },
    { question: 'A sphere’s volume grows at 36π cm³/s. Find dr/dt when r = 3 cm.', answer: '1 cm/s. From V = (4/3)πr³, dV/dt = 4πr²(dr/dt); divide 36π by 4π(3²).' },
    { question: 'Water fills a cylindrical tank of fixed radius 2 m at 3 m³/min. How quickly does the water depth increase?', answer: '3/(4π) m/min. V = π(2²)h, so dV/dt = 4π dh/dt.' },
    { question: 'Two cyclists leave an intersection along perpendicular roads. One travels at 6 m/s and the other at 8 m/s. How quickly does their separation grow 10 seconds later?', answer: '10 m/s. At 10 s, x = 60, y = 80 and z = 100. Differentiate z² = x² + y²: dz/dt = (60·6 + 80·8)/100.' },
    { question: 'A cube’s side length shrinks at 0.5 cm/s. How quickly does its volume change when the side is 6 cm?', answer: '−54 cm³/s. From V = s³, dV/dt = 3s² ds/dt = 3(36)(−0.5).' },
  ].slice(0, Math.min(6, Math.max(2, count)));
}
function practice(topic) {
  return `<details class="unit" ${topic.review ? 'open' : ''}><summary>${e(topic.title)} · ${topic.practiceCount} suggested problems</summary><div class="unit-content">
    <p>${link(topic.url, 'OpenStax lesson and section exercises')}</p>
    <p class="meta">Free online reading. Follow the source’s licensing terms. Choose ${topic.practiceCount} exercises from this section, then check your work.</p>
    ${topic.id === 'related-rates' ? `<p>Or start here with original Study Commons practice:</p>${relatedRatesProblems(topic.practiceCount).map((problem, index) => `<article class="resource"><p><strong>${index + 1}.</strong> ${e(problem.question)}</p><details><summary>Show worked answer</summary><p>${e(problem.answer)}</p></details></article>`).join('')}` : ''}
    </div></details>`;
}
export function pastPapersView(name) {
  const papers = resourcesFor(name).filter(item => item.type === 'Past exam');
  if (!papers.length) return '';
  return `<section class="exam-library"><p class="eyebrow">College Board · Official source</p><h2>AP past exam papers & scoring</h2>
    <p>Released free-response questions, scoring guides and sample responses. Open the official archive for available years. These are released exam materials, not a complete bank of multiple-choice papers.</p>
    ${/AP Computer Science|AP Economics/i.test(name) ? '<p class="meta">Your course name does not specify the AP exam. Choose the version confirmed by your teacher.</p>' : ''}
    <ul class="exam-links">${papers.map(item => `<li>${link(item.url, item.title)}</li>`).join('')}</ul>
    <p class="meta">Free access · College Board copyright. Materials open on the publisher’s website.</p></section>`;
}
export function publicResourcesView(name) {
  const resources = resourcesFor(name).filter(item => item.type !== 'Past exam');
  return `<section><h2>Public resources for this course</h2><p class="muted">Matched by course subject. Check your teacher’s syllabus for assigned readings and exam coverage.</p>
    ${courseNames.includes(name.trim()) ? `<p><a class="button" href="#course/${e(courseSlug(name))}/resources">Open the school resource library</a></p>` : ''}
    ${pastPapersView(name)}${resources.length ? `<ul class="canvas-resource-list">${resources.map(item => `<li>${link(item.url, item.title)}<p class="meta">${e(item.source)} · ${e(item.rights)}</p></li>`).join('')}</ul>` : '<p>No subject-specific textbook links have been curated yet.</p>'}</section>`;
}
export function gradesView(record, grades, busy) {
  grades = grades?.isDemo ? grades : null;
  const priorities = studyPriorities(record.course.name, grades);
  const review = priorities.filter(topic => topic.review);
  const assignments = grades?.assignments || [];
  return `<section class="canvas-panel"><div class="section-heading"><h2>Sample grades & study plan</h2>
    <form data-canvas-form="grades" data-course="${e(record.course.id)}"><button ${busy ? 'disabled' : ''}>${busy ? 'Resetting…' : 'Reset sample grades'}</button></form></div>
    <p class="canvas-alert"><strong>Demo grades — not your actual results.</strong> Your course, assignment names and class materials are real. Every score and point total shown here is fictional, including the course average. Study recommendations below illustrate how the feature works; they do not describe your performance.</p>
    ${grades ? `<div class="grade-summary"><div><span class="meta">Illustrative course grade</span><p class="grade-value">${e(gradeLabel(grades))}</p></div></div><p class="meta">Sample assignment scores use an invented 100-point scale. No grades are requested from Canvas.</p>` : '<p>Sample grades are not loaded yet.</p>'}
    <h3>Example study priorities</h3><p class="muted">A sample average below 80% on a supported topic suggests six practice problems instead of two. This is an example, not a mastery score.</p>
    ${review.length ? review.map(topic => `<article class="canvas-record"><h3>${e(topic.title)} <span class="badge">Demo recommendation</span></h3><p>${e(percent(topic.average))} sample average across ${topic.evidence.length} matching assignment${topic.evidence.length === 1 ? '' : 's'}. Try six problems to demonstrate targeted practice.</p><ul>${topic.evidence.map(item => `<li>${link(item.url, item.title)} · Sample: ${e(item.score)} / ${e(item.pointsPossible)}</li>`).join('')}</ul></article>`).join('') : '<p>No supported topic matches a low sample score in these assignment titles. Choose practice below. The app does not invent topics for broadly named or numbered assignments.</p>'}
    <p class="meta">Topic matching supports four calculus topics and three chemistry topics. All recommendations on this screen use fictional scores.</p>
    <h3>Choose focused practice</h3>${priorities.length ? priorities.map(practice).join('') : '<p>Use the subject library below for reading and practice.</p>'}
    ${assignments.length ? `<details class="grade-list"><summary>Real assignments with sample grades (${assignments.length})</summary><div class="table-scroll"><table><thead><tr><th>Canvas assignment</th><th>Fictional score</th><th>Data type</th></tr></thead><tbody>${assignments.map(item => `<tr><td>${link(item.url, item.title)}</td><td>${e(item.score)} / ${e(item.pointsPossible)}</td><td>Demo only</td></tr>`).join('')}</tbody></table></div></details>` : '<p>No accessible assignments were returned for this course. The course grade above is a standalone sample.</p>'}
    </section>${publicResourcesView(record.course.name)}`;
}
