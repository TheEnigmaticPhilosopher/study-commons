# Real courses with sample grades

The pilot preserves all 64 imported Canvas course records and their modules, assignments, pages, files, announcements, quizzes and original material links. Canvas permissions still determine which categories can be read. Course materials require the existing pilot sign-in; opening original resources may also require Canvas sign-in.

The public library uses 46 distinct readable course names approved for publication. Historical sections and summer work retain their names; this is not an official current school catalog. Seven unnamed records are omitted from the public catalog. Signed-in public course pages link to the corresponding real Canvas course sections. Public resource links and official AP exam materials are independently curated.

## All displayed grades are fictional

`lib/demo-grades.js` generates deterministic sample scores using only real course and assignment identifiers. It never reads actual grades. Assignment names and URLs remain real; scores and 100-point totals are invented. The API sets `gradeMode: demo`, and every sample grade record and assignment has `isDemo: true`. Dashboard cards, the grade view and study recommendations explicitly identify this demo data.

Both the local and Vercel APIs generate sample grades directly from the metadata snapshot. They do not read the previous real-grade storage record. Authenticated `POST /api/canvas/grades` now resets sample grades without calling Canvas grade endpoints and replaces the old private grade record with an empty sample-only marker. Run `node scripts/sync-hosted-grades.js` after deployment to clear that record and verify all materials are unchanged. The script prints counts only. Material imports remain read-only Canvas operations and do not include submission grades.

Topic suggestions are illustrations based entirely on fictional scores, not assessments of the student's performance. Up to five matching single-topic assignments form a sample average; below 80% suggests six problems instead of two. Supported topics are related rates, chain rule, implicit differentiation, optimization, buffers, equilibrium constants and rate laws. Broadly named tests are not assigned invented topics. The related-rates panel includes six original practice problems and worked answers.

## Publisher resources

Each AP course has an official past-exam panel. Calculus AB and Chemistry include verified direct 2025/2026 question and scoring PDFs. Other subjects link official archives. Ambiguous Computer Science/Economics names show both exam variants and ask students to confirm the exam with their teacher. These are released FRQs/assessment materials, not a full multiple-choice bank. All nine AP Chemistry units include linked OpenStax readings. Publisher texts and exam papers are linked, not mirrored.

References checked October 1, 2026:

- AP archives: https://apcentral.collegeboard.org/courses/past-exam-questions
- Calculus AB: https://apcentral.collegeboard.org/courses/ap-calculus-ab/exam/past-exam-questions
- Chemistry: https://apcentral.collegeboard.org/courses/ap-chemistry/exam/past-exam-questions
- Related rates: https://openstax.org/books/calculus-volume-1/pages/4-1-related-rates

Grades and materials are never included in the public catalog or GitHub source. No automatic publication of new course names occurs during import. This remains a single-owner pilot, not a multi-student account system.
