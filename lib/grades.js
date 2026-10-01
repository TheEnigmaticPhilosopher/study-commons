const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value.slice(0, 500) : '';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

// Explicit projection: no identities, comments, submission bodies or unposted grades.
export function normalizeGrades(courseId, selfId, enrollments, assignments, baseUrl) {
  const own = enrollments.filter(item => String(item.user_id) === selfId && String(item.course_id) === courseId && item.type === 'StudentEnrollment');
  const enrollment = own.find(item => item.enrollment_state === 'active') || own[0];
  const grades = enrollment?.grades;
  return {
    status: enrollment ? 'synced' : 'unavailable',
    message: enrollment ? '' : 'Canvas did not return your student enrollment for this course.',
    syncedAt: new Date().toISOString(),
    currentScore: number(grades?.current_score), currentGrade: text(grades?.current_grade),
    finalScore: number(grades?.final_score), finalGrade: text(grades?.final_grade),
    enrollmentState: text(enrollment?.enrollment_state),
    url: `${baseUrl}/courses/${courseId}/grades`,
    assignments: enrollment ? assignments.filter(item => item.published !== false && item.workflow_state !== 'deleted' &&
      /^\d+$/.test(String(item.id)) && String(item.submission?.user_id) === selfId && item.submission?.assignment_visible !== false)
      .map(item => {
        const submission = item.submission;
        const posted = Boolean(date(submission.posted_at)) && item.muted !== true && submission.excused !== true;
        return { id: String(item.id), title: text(item.name), pointsPossible: number(item.points_possible),
          score: posted ? number(submission.score) : null, grade: posted ? text(submission.grade) : '',
          postedAt: posted ? date(submission.posted_at) : null, dueAt: date(item.due_at),
          gradedAt: posted ? date(submission.graded_at) : null, missing: submission.missing === true,
          late: submission.late === true, excused: submission.excused === true,
          excluded: item.omit_from_final_grade === true || item.grading_type === 'not_graded',
          currentAttempt: submission.grade_matches_current_submission !== false,
          url: `${baseUrl}/courses/${courseId}/assignments/${item.id}` };
      }) : [],
  };
}
