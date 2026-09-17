# School study hub

Study Commons is a school-specific course resource hub with Canvas-style navigation. Students choose courses from a school catalog and add them to a personal dashboard.

Each subject has a maintained library and discussion board. AP Chemistry has nine units; English can organize material by books or writing skills. Resources can include official exam questions, notes, open educational material and original student contributions, with a recorded creator/source.

The subject library is conceptually shared. Class sections, teachers and academic years have different schedules, which belong to the actual class rather than the entire subject.

## Current implementation

- Editable school name, example catalog, tailored course units and resource links.
- Browser-local dashboard selections, questions, replies, answered states and pending suggestions.
- Private single-user Canvas login and read-only sync for one configured course.
- SQLite snapshots, manual module/event mappings, sync status and failure recovery.
- Linked Canvas resources and explicit teaching dates within study-hub units.
- Fictional demo mode with a rescheduling scenario.
- Node.js server, Replit configuration and automated fixture tests.

The example catalog is not a verified school catalog. A student's private Canvas content appears only in the signed-in personal pilot. No credentials or synced course data belong in the repository.

## Work remaining for school use

- School accounts, membership checks and server-side role/ownership permissions.
- Shared database-backed discussions, resource review, reporting and moderation.
- Per-user Canvas OAuth with a school-approved developer key.
- Enrollment and section-aware course access and schedules.
- Durable hosted storage, shared sessions and operational monitoring.
- Teacher-confirmed pacing editor, background sync and schedule-aware dashboard.

Questions and suggestions are not yet sent to a shared server or moderator. The browser's “mine” flag is a demo display convention, not authorization.
