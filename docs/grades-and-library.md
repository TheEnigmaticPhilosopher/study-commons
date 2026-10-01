# School catalog and private grades

The public library uses 46 distinct readable names from the authorized Canvas pilot snapshot. Historical sections and summer work are retained as named; this is not an official current school catalog. Seven unnamed records are omitted. The 64 original course records remain in private storage.

`public/course-names.js` contains only the approved names. `public/library.js` supplies editorial resource links. No automatic public publication occurs during a Canvas import. New public names require an intentional source change. Licensing labels distinguish free access from public domain; links open publisher originals. Public outlines are curated library sections, not imported teaching schedules.

Authenticated `POST /api/canvas/grades` accepts an imported `courseId`. It resolves `/users/self/profile`, filters enrollments to that numeric user and StudentEnrollment, and requests assignments with `include[]=submission` (the requesting user's submission). Both enrollment and submission identities are checked again before normalization. Only posted scores are retained; unposted aggregates, identities, submission bodies and comments are dropped. Grade storage is separate from the Canvas metadata snapshot and SALTY feed. A 403/404 clears grades for that course; a transient failure preserves the prior timestamp. Grades refresh independently from materials.

The UI uses Canvas's whole-course `current_score` and `final_score`, not a recalculated weighted total. Final scores can include ungraded work as zero. Null is unavailable, never converted to zero. Check Canvas for current grading-period totals or school-specific policies.

Study suggestions match explicit assignment-title phrases against seven supported calculus/chemistry topics. Assignments naming multiple supported topics are excluded. Up to five latest eligible assignments form an unweighted percentage average for that topic; below 80% increases suggested practice from two to six. One assignment is labeled tentative. Missing, late, excused, unposted, superseded, zero-point and omitted assignments are excluded. Scores and titles cannot establish mastery or pinpoint mistakes inside a broad test. Other subjects have grades and public resources, but no automatic topic diagnosis yet. Related-rates practice includes six original problems and worked answers.

Public references checked September 30, 2026:

- Canvas enrollments: https://developerdocs.instructure.com/services/canvas/resources/enrollments
- Canvas own submission include: https://developerdocs.instructure.com/services/canvas/resources/assignments
- Canvas posted scores: https://developerdocs.instructure.com/services/canvas/resources/submissions
- AP released questions: https://apcentral.collegeboard.org/courses/past-exam-questions
- Related-rates reading and exercises: https://openstax.org/books/calculus-volume-1/pages/4-1-related-rates

Official AP archives rechecked October 1, 2026. Each AP course has a prominent past-exam panel. Calculus AB and Chemistry include verified direct 2025/2026 question and scoring PDFs. Other subjects link their official archives. Ambiguous Computer Science/Economics course names show both exam variants and ask students to confirm the exam with their teacher. These are released FRQs/assessment materials, not a full multiple-choice exam bank.

All imported grades remain behind the existing single-owner pilot sign-in. This is not a multi-student authentication system. Do not share the owner password with visitors.
