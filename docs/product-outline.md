# School study hub

Study Commons is a school-specific course resource hub with Canvas-style navigation. Students choose courses from the school's catalog and add them to a personal dashboard.

## Course spaces

Each course has a maintained resource library and a discussion board. The course outline is tailored to its content: AP Chemistry can use nine units, while English can use books, writing skills and reading topics. Resources can include published exam questions, notes, open educational material and original student contributions. Link to publisher originals and record the creator/source of each resource.

The course library is shared conceptually across students taking the same subject. Class sections, teachers and academic years can have different pacing schedules. Those schedules should be attached to the relevant class instead of duplicating the entire library.

## Discussions and optional contributions

Students can ask course questions, add a topic tag, reply and mark their own questions answered. In a shared implementation, questions would normally appear immediately, with reporting and moderator oversight. Resource suggestions are a smaller supporting feature and require review before joining the maintained library.

## Planned Canvas connection

A Canvas connection would associate a student's actual class with the course library and retrieve permitted module and calendar information. Explicit lesson dates or a teacher-confirmed pacing guide determine a unit's planned teaching window. Module availability and assignment deadlines remain separately labeled dates.

For example, AP Chemistry Unit 9 might show a planned teaching window of March 15–19, 2027, with related notes, practice resources and discussions. The view should identify its schedule source and last successful sync time. If dates are inferred, they must be labeled estimated. Missing dates should remain unscheduled.

## Current implementation

- Editable school name, example catalog and course-specific module structures.
- Personal dashboard course selection.
- Course resources and discussions, question/reply forms and answered states.
- Optional resource suggestions displayed as pending.
- Browser-local persistence, responsive layout and light/dark appearance.
- Dependency-free Node static server and Replit configuration.

## Still to implement for shared school use

- School accounts, membership checks and server-side permissions.
- Shared database-backed discussions, resource review and reporting.
- Canvas API authentication, import, module/event mappings and synchronization.
- Teacher-confirmed pacing editor and schedule-aware dashboard.

The current example content is not a verified school catalog. No Canvas course is connected, and there are no real student records or credentials in this repository.
