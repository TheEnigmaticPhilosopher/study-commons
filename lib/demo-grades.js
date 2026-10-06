import { createHash } from 'node:crypto';

const sample = key => 55 + createHash('sha256').update(`study-commons-sample-v1:${key}`).digest()[0] % 44;
// Generated only from course/assignment metadata. Never reads stored real grades.
export function demoGrades(record) {
  const courseId = record.course.id;
  const assignments = (record.assignments || []).map(item => ({
    id: item.id, title: item.title, url: item.url, dueAt: item.dueAt,
    score: /\brelated[ -]rates?\b/i.test(item.title) ? 62 : sample(`${courseId}:${item.id}`),
    pointsPossible: 100, grade: '', postedAt: record.attemptedAt || '2026-01-01T00:00:00Z',
    gradedAt: record.attemptedAt || '2026-01-01T00:00:00Z',
    missing: false, late: false, excused: false, excluded: false, currentAttempt: true,
    isDemo: true,
  }));
  const currentScore = assignments.length ? Math.round(assignments.reduce((sum, item) => sum + item.score, 0) / assignments.length * 10) / 10 : sample(courseId);
  return { status: 'demo', isDemo: true, currentScore, currentGrade: '', finalScore: null, finalGrade: '',
    message: 'Fictional grades for demonstration. Assignment names and class materials come from Canvas; all scores and point totals are invented.',
    assignments };
}
export function demoGradeCatalog(account) {
  return Object.fromEntries((account.snapshot?.courses || []).map(record => [record.course.id, demoGrades(record)]));
}
