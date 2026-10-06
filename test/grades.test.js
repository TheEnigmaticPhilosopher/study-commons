import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrades } from '../lib/grades.js';
import { demoGrades, demoGradeCatalog } from '../lib/demo-grades.js';
import { createCanvasClient } from '../lib/canvas.js';
import { studyPriorities, relatedRatesProblems, gradesView, pastPapersView } from '../public/study.js';
import { resourcesFor } from '../public/library.js';
import { courses } from '../public/data.js';
import { courseNames } from '../public/course-names.js';

const enrollment = { user_id: 9, course_id: 1, type: 'StudentEnrollment', enrollment_state: 'active', grades: { current_score: 86, final_score: 75, unposted_current_score: 94 } };
const assignment = { id: 2, name: 'Related rates quiz', points_possible: 10, submission: { user_id: 9, score: 6, grade: '6', posted_at: '2026-09-20T00:00:00Z', graded_at: '2026-09-19T00:00:00Z', body: 'private essay' } };
const normalize = (assignments = [assignment], enrollments = [enrollment]) => normalizeGrades('1', '9', enrollments, assignments, 'https://canvas.example.test');
test('grades project only the current student and posted values, including an actual zero', () => {
  const data = normalize([assignment, { ...assignment, id: 3, submission: { ...assignment.submission, user_id: 10 } }, { ...assignment, id: 4, submission: { ...assignment.submission, score: 0 } }], [{ ...enrollment, user_id: 10, grades: { current_score: 99 } }, enrollment]);
  assert.equal(data.currentScore, 86);
  assert.equal(data.assignments.length, 2);
  assert.equal(data.assignments[1].score, 0);
  assert.doesNotMatch(JSON.stringify(data), /unposted|private essay|user_id|94/);
  assert.equal(normalize([], [{ ...enrollment, user_id: 10 }]).status, 'unavailable');
  assert.equal(normalize([], [{ ...enrollment, type: 'TeacherEnrollment' }]).assignments.length, 0);
});
test('null, unposted, excused and hidden grades are not exposed as numeric scores', () => {
  for (const change of [{ score: null }, { posted_at: null }, { excused: true }]) assert.equal(normalize([{ ...assignment, submission: { ...assignment.submission, ...change } }]).assignments[0].score, null);
  assert.equal(normalize([{ ...assignment, muted: true }]).assignments[0].score, null);
  assert.equal(normalize([{ ...assignment, submission: { ...assignment.submission, assignment_visible: false } }]).assignments.length, 0);
  assert.equal(normalize([], [{ ...enrollment, grades: { current_score: null } }]).currentScore, null);
});
test('low topic evidence increases practice, while missing/late/mixed/ungraded work does not', () => {
  const plan = studyPriorities('AP Calculus AB', normalize());
  assert.equal(plan[0].id, 'related-rates'); assert.equal(plan[0].practiceCount, 6);
  assert.equal(plan[0].average, 60);
  const entry = normalize().assignments[0];
  for (const change of [{ missing: true }, { late: true }, { excused: true }, { excluded: true }, { currentAttempt: false }, { score: null }, { pointsPossible: 0 }, { postedAt: null }, { title: 'Unit 4 test' }, { title: 'Related rates and chain rule' }]) {
    assert.equal(studyPriorities('AP Calculus AB', { status: 'synced', assignments: [{ ...entry, ...change }] }).some(topic => topic.review), false);
  }
  assert.equal(studyPriorities('AP Biology', normalize()).length, 0);
  assert.equal(studyPriorities('AP Calculus AB', { currentScore: 20 }).some(topic => topic.review), false);
});
test('topic average uses latest five eligible assignments and does not masquerade as overall grade', () => {
  const entry = normalize().assignments[0];
  const assignments = Array.from({ length: 6 }, (_, i) => ({ ...entry, id: String(i), score: i ? 10 : 0, gradedAt: `2026-09-${10 + i}T00:00:00Z` }));
  const topic = studyPriorities('AP Calculus AB', { status: 'synced', assignments })[0];
  assert.equal(topic.evidence.length, 5); assert.equal(topic.average, 100); assert.equal(topic.review, false);
});
test('Canvas client constrains enrollment pagination to self and requests only own submission include', async () => {
  const calls = [];
  const client = createCanvasClient({ baseUrl: 'https://canvas.example.test', token: 'fixture' }, async (input, options) => {
    const url = new URL(input); calls.push(url);
    assert.equal(options.method, 'GET');
    if (url.pathname.endsWith('/profile')) return Response.json({ id: 9, name: 'Do not store' });
    if (url.pathname.endsWith('/enrollments')) {
      assert.equal(url.searchParams.get('user_id'), '9');
      assert.deepEqual(url.searchParams.getAll('type[]'), ['StudentEnrollment']);
      return Response.json([enrollment]);
    }
    assert.equal(url.searchParams.get('include[]'), 'submission');
    return Response.json([assignment]);
  });
  assert.equal((await client.syncGrades('1')).assignments[0].score, 6);
  assert.equal(calls.length, 3);
});
test('public catalog contains approved names and public links, no Canvas records or identifiers', () => {
  assert.equal(courseNames.length, 46); assert.equal(courses.length, 46);
  assert.equal(new Set(courses.map(course => course.id)).size, courses.length);
  assert.equal(courses.some(course => /^Course \d+$/.test(course.name)), false);
  for (const course of courses) {
    assert.ok(courseNames.includes(course.name));
    for (const resource of course.resources) {
      assert.equal(new URL(resource.url).protocol, 'https:');
      assert.ok(course.units.some(unit => unit.id === resource.unitId));
    }
  }
  assert.doesNotMatch(JSON.stringify(courses), /instructure\.com|currentScore|submission|access_token|user_id/);
});
test('practice and private grade views escape assignment names and explain uncertainty', () => {
  assert.equal(relatedRatesProblems(6).length, 6); assert.equal(relatedRatesProblems().length, 2);
  const grades = demoGrades({ course: { id: '1' }, assignments: [{ id: '2', title: '<img src=x> Related rates', url: 'https://canvas.example.test/courses/1/assignments/2' }] });
  const html = gradesView({ course: { id: '1', name: 'AP Calculus AB' } }, grades, false);
  assert.doesNotMatch(html, /<img src=x>/); assert.match(html, /Demo recommendation/); assert.match(html, /not a mastery score/);
});

test('sample grades preserve real assignment identity but cannot use actual grade fields', () => {
  const record = { course: { id: '1', name: 'AP Calculus AB' }, assignments: [{ id: '2', title: 'Related rates', url: 'https://canvas.example.test/a', score: 99.123456, pointsPossible: 200 }], grades: { currentScore: 98.654321 } };
  const grades = demoGrades(record);
  assert.equal(grades.isDemo, true); assert.equal(grades.status, 'demo');
  assert.equal(grades.assignments[0].title, record.assignments[0].title);
  assert.equal(grades.assignments[0].url, record.assignments[0].url);
  assert.equal(grades.assignments[0].pointsPossible, 100);
  assert.equal(grades.assignments[0].score, 62);
  assert.doesNotMatch(JSON.stringify(grades), /99\.123456|98\.654321/);
  assert.equal(studyPriorities('AP Calculus AB', grades)[0].practiceCount, 6);
  assert.deepEqual(demoGrades(record), grades);
  assert.equal(Object.keys(demoGradeCatalog({ snapshot: { courses: [record] } })).length, 1);
});

test('each AP course links official past exams and AB/Chemistry offer paired paper and scoring PDFs', () => {
  for (const course of courses.filter(course => /\bAP\b|APUSH/.test(course.name))) {
    const exams = resourcesFor(course.name).filter(resource => resource.type === 'Past exam');
    assert.ok(exams.length > 0, course.name);
    for (const exam of exams) assert.equal(new URL(exam.url).hostname, 'apcentral.collegeboard.org');
  }
  for (const name of ['AP Calculus AB', 'AP Chemistry']) {
    const html = pastPapersView(name);
    for (const year of [2025, 2026]) { assert.match(html, new RegExp(`${year} question paper`)); assert.match(html, new RegExp(`${year} scoring guidelines`)); }
  }
  assert.doesNotMatch(pastPapersView('AP Calculus BC'), /ap26-frq-calculus-ab/);
  assert.match(pastPapersView('AP Computer Science'), /confirmed by your teacher/);
  assert.equal(pastPapersView('Latin 1'), '');
});
