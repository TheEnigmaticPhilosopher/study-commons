# School study hub

Study Commons is a school-specific course resource hub with Canvas-style navigation. Students choose courses from a school catalog and add them to a personal dashboard.

Each subject has a maintained library and discussion board. AP Chemistry has nine units; English can organize material by books or writing skills. Resources can include official exam questions, notes, open educational material and original student contributions, with a recorded creator/source.

The subject library is conceptually shared. Class sections, teachers and academic years have different schedules, which belong to the actual class rather than the entire subject.

## Current implementation

- Editable school name, 46 approved public course names, tailored units and curated resource links, including official AP exam archives and OpenStax readings.
- Browser-local dashboard selections, questions, replies, answered states and pending suggestions.
- Private single-user Canvas login and read-only discovery of available/completed courses.
- Automatically linked course cards, original Canvas modules, and course-wide resource tabs.
- SQLite locally and private Vercel Blob storage for hosted snapshots, sessions, resumable imports, teaching-event mappings and submission receipts.
- Linked Canvas resources and explicit teaching dates within original modules; optional mappings to example library units.
- Fictional demo mode with a rescheduling scenario.
- Real private class metadata and original material links, with clearly labeled fictional grades and sample topic practice recommendations.
- Reviewed personal-account text, URL and small-file submissions to Canvas, with live eligibility checks, receipts and duplicate-send protection.
- Scoped read-only SALTY resource connector, prepared and disabled until configured.
- Node.js server, Replit configuration, a deployed Vercel personal pilot and automated fixture tests.

The public catalog is not a verified current school offering list. Private Canvas content appears only in the signed-in personal pilot. No credentials or synced course data belong in the repository. Grades are fictional; assignment submissions send real work as the connected token owner.

## Work remaining for school use

- School accounts, membership checks and server-side role/ownership permissions.
- Shared database-backed discussions, resource review, reporting and moderation.
- Per-user Canvas OAuth with a school-approved developer key.
- Enrollment and section-aware course access and schedules.
- School-scale account isolation, storage operations and operational monitoring.
- Teacher-confirmed pacing editor, background sync and schedule-aware dashboard.

Questions and suggestions are not yet sent to a shared server or moderator. The browser's “mine” flag is a demo display convention, not authorization.
