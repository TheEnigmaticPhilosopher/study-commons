# Canvas course demo: setup and acceptance test

This backend supports a private test of one course using your own Canvas account. Canvas allows manual personal tokens for development; applications used by multiple users must use OAuth. Your school can restrict token generation and API access. [Canvas OAuth guide](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth).

## 1. Choose the course and identity

Use a course you can already open in Canvas, or a school-provided dummy course with an authorized test account. For a pitch to other people, the dummy course is preferable because it contains fictional material.

A URL such as `https://school.instructure.com/courses/12345` gives you:

- `CANVAS_BASE_URL=https://school.instructure.com`
- `CANVAS_COURSE_ID=12345`

Canvas is the school's **LMS** (learning management system). The integration does not require an LLM.

## 2. Create and keep a private token

In Canvas, go to Account → Settings → Approved Integrations and create a personal access token if your school enables that option. Use an expiration appropriate for your test. The token inherits your account's access; this app restricts itself to one configured course and uses GET requests, but that does not make the token itself read-only.

If a key was exposed in chat or source code, revoke it and create a replacement. Do not send the replacement to another person or paste it into a repository.

For a future school rollout, request an OAuth developer key from the school administrator. Do not collect classmates' manually generated tokens.

## 3. Configure the server

For local use, copy `.env.example` to `.env` and set:

```dotenv
PORT=3000
APP_ORIGIN=http://localhost:3000
HUB_ADMIN_PASSWORD=
CANVAS_MODE=live
CANVAS_BASE_URL=https://school.instructure.com
CANVAS_COURSE_ID=12345
CANVAS_ACCESS_TOKEN=
DATABASE_PATH=./data/study-commons.sqlite
```

Enter a strong, unique password of at least 16 characters after `HUB_ADMIN_PASSWORD=`. Enter your fresh Canvas key after `CANVAS_ACCESS_TOKEN=`. These are different credentials. Quote values containing spaces or `#` when using dotenv.

On Replit, add these values through **Secrets**, not a source file. Use the exact HTTPS app address for `APP_ORIGIN`. Open that address in its own tab: the private pilot blocks cross-site embedding. An origin error means the address you opened differs from this setting. Restart after changing secrets.

The repository ignores `.env` and `data/`. Never upload those paths through GitHub's web interface, which does not enforce a local `.gitignore`.

## 4. Start and sign in

Run `node server.js`. Open the app and select **Canvas connection**. Sign in with `HUB_ADMIN_PASSWORD`, not your Canvas token or school password.

Without a configured demo password, the server denies access to the Canvas endpoints. Sessions expire after eight hours, are invalidated by sign-out, and end on server restart. This is a single-user pilot login, not student identity or school SSO.

## 5. Perform the first sync

Choose the calendar date range, then click **Sync now**. The backend reads:

- `GET /api/v1/courses/:course_id`
- `GET /api/v1/courses/:course_id/modules`
- `GET /api/v1/courses/:course_id/modules/:module_id/items?include[]=content_details`
- `GET /api/v1/calendar_events?context_codes[]=course_:course_id&type=event&start_date=...&end_date=...`

Pagination follows only the configured Canvas origin and the same endpoint. Calendar course/date filters remain fixed. Redirects are rejected so credentials are not forwarded. Requests are bounded to 100 pages per endpoint, 200 modules, 15 seconds per request and two minutes for a complete sync.

The snapshot includes titles, IDs, Canvas links and selected dates. It does not download files or HTML pages and does not query grades, student submissions or rosters. Only course-scoped calendar events are used; personal calendar events and appointment reservations are excluded.

## 6. Match Canvas records to hub units

Expand a synced module and choose its study-hub course and unit, then **Save link**. The module's resource links appear inside that unit.

Under **Link teaching events**, link an event only when it represents actual teaching time for the unit. Its dates then appear under **Scheduled teaching** alongside the library resources. Dates use the course time zone; all-day events show their calendar date.

For a dummy AP Chemistry course, the teacher can add a course calendar event titled “Unit 9 teaching week,” starting March 15 and ending March 19, 2027. Link it to AP Chemistry → Unit 9. These example dates do not describe your actual school schedule.

A due date means an assignment is due. A module unlock date means its contents become available. Neither proves when the class will study a unit. If there is no explicit calendar event, the app leaves teaching time unspecified. It does not parse a syllabus or guess dates.

## 7. Check updates and failure recovery

For a dummy course, have its authorized teacher:

1. Move the linked event to March 22–26, 2027. Sync again and confirm the dates change.
2. Rename a linked module. Its stable ID should preserve the unit link.
3. Sync again without changes. No records should duplicate.
4. Delete an event or module. A successful sync should remove it from the displayed snapshot.
5. Revoke the test token. A later sync should show an error while retaining the prior snapshot and timestamp. The saved private data is not automatically erased on revocation.
6. Replace the token privately. This intentionally starts a separate cache; re-link units.
7. Sign out. Canvas details and linked Canvas resources should disappear; unauthenticated API calls return 401.

A date-window change replaces the event snapshot with that window's events. Mappings are retained by ID, so re-expanding the window can restore the link. Out-of-window or deleted records are never rendered solely from an old mapping.

## 8. Try the fixture demonstration without school access

Set `CANVAS_MODE=demo`, keep your unique demo password, and restart. No real Canvas credentials are used. Sync March 1–31, 2027, link the Unit 9 module and teaching event, then switch the scenario to “Unit 9 moved to March 22–26” and sync again.

The fixture runs through the same normalization and snapshot code. It validates the hub's behavior, but it cannot prove your school's permissions, course data or API availability.

## Troubleshooting

| Result | What to check |
| --- | --- |
| Missing settings | Add the named settings privately and restart. |
| 401 from Canvas | Correct domain, unexpired token, revoked key. |
| 403 from Canvas | Your account's course/API permissions. Ask the school if needed. |
| 404 from Canvas | Course ID or course/module visibility. |
| 429 from Canvas | Wait before syncing again. |
| No calendar events | Widen the date range or ask the teacher to add a lesson event. |
| Section-specific dates missing | This pilot does not expand hidden parent events or resolve student section enrollment. Use a course-level dummy event to demonstrate; add section-aware OAuth access before rollout. |
| Origin error | Set APP_ORIGIN to the exact standalone app address you are using. |
| Data disappears after deployment | The deployment filesystem is not durable. Use a persistent database for ongoing use. |

## Limits before sharing with a school

Do not share the personal demo password to give others access to your real course. Use fictional data for a public pitch. A school version needs per-user Canvas OAuth, school membership checks, section-aware access, shared sessions and a durable database. Shared discussions and moderation have not been moved to the backend yet.

Imported snapshots are stored unencrypted in the local SQLite database; protect the machine/workspace and its backups. The app never serves that file. To erase all local pilot snapshots, stop the server and remove the configured database and any SQLite sidecar files.

## References

- [Canvas personal tokens and OAuth](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)
- [Modules and module items](https://developerdocs.instructure.com/services/canvas/resources/modules)
- [Calendar event scope and date filtering](https://developerdocs.instructure.com/services/canvas/resources/calendar_events)
- [Canvas pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination)
- [Replit Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets)
