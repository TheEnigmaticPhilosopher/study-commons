# Link a school-provided Canvas test course

**Status:** This is an implementation and setup guide. The included app has no Canvas connector, database or Sync now button yet. Entering the settings below alone will not enable syncing.

The initial target is a private, single-developer pilot that reads one approved dummy course. School-wide use and connections for multiple users require an approved OAuth integration and server-side access controls.

## 1. Ask the school for the pilot access

Suggested request:

> Could you provide a dummy Canvas course and a test account assigned to me, ideally with access only to that course? I would like to test reading its modules, resource links and lesson calendar events into a study hub. Please confirm whether I may generate an API token for this development test or whether the pilot must use OAuth. A teacher would need to be able to edit the dummy course so we can test schedule changes.

Record the course URL, the test account's role and the approved authentication method. A personal token inherits its account's permissions; it is not inherently read-only or limited to a single course. Keep the test account limited to the dummy course where possible, allowlist that course in the connector and make only read requests to Canvas.

## 2. Record the domain and course ID

For the example URL `https://school.instructure.com/courses/12345`:

```text
CANVAS_BASE_URL=https://school.instructure.com
CANVAS_COURSE_ID=12345
```

Use the school's exact supplied domain, including a test-environment subdomain if applicable. Credentials must belong to that environment.

## 3. Set up approved authentication

For your own development testing, Canvas's developer documentation describes manually generating a token from your user account before implementing OAuth. Your institution may restrict token creation or require OAuth instead.

If the school approves the single-tester token approach, sign into the account assigned to you and open **Account → Settings → Approved Integrations → Add New Access Token**. Enter a clear purpose and an expiration date. If the option is unavailable, ask the Canvas administrator to arrange approved access. Do not ask students or teachers to paste their personal tokens into the app.

For an OAuth pilot, the school administrator creates and enables an API developer key, registers the app's callback URL and permits the required read scopes. Implement the authorization-code flow, state validation, token storage and refresh handling. Authorize each connecting user separately. OAuth endpoint scopes restrict API operations; user/course permissions still determine what data the user can access.

References: [Canvas OAuth and development testing](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth), [managing user tokens](https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account), [developer keys](https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys).

## 4. Configure server secrets

For the single-tester approach, add these values to your project's **Replit Secrets**:

| Name | Value |
| --- | --- |
| `CANVAS_BASE_URL` | Exact Canvas domain |
| `CANVAS_COURSE_ID` | Dummy course's numeric ID |
| `CANVAS_ACCESS_TOKEN` | Approved token for your test account |

Keep tokens out of frontend code, URLs, repository files and logs. `.env.example` contains placeholders only. The current server does not load `.env` or use the Canvas variables; the connector must be implemented first for in-app syncing.

Reference: [Replit Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets).

## 5. Verify course access

After configuring the secrets, run this in the Replit Shell:

```bash
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $CANVAS_ACCESS_TOKEN" \
  "$CANVAS_BASE_URL/api/v1/courses/$CANVAS_COURSE_ID"
```

The response should contain the dummy course's ID and name. This checks the credentials independently of the app. If it fails, check token validity, account permissions, domain and course ID. A 404 can also mean the course is not visible to the account.

## 6. Implement the connector

Extend the Node backend with a Canvas API client, an authorized sync action and a database. Keep the approved domain and course allowlist on the server. Relevant read endpoints are:

```text
GET /api/v1/courses/:course_id
GET /api/v1/courses/:course_id/modules
GET /api/v1/courses/:course_id/modules/:module_id/items
GET /api/v1/calendar_events
```

For calendar events, explicitly set `type=event`, `context_codes[]=course_<id>`, `start_date` and `end_date`. Defaults otherwise may omit the course or future dates. For this demo, use the whole March 2027 window, not just today's date. Follow Canvas pagination links, keeping credentials restricted to the trusted Canvas origin. Honor access restrictions and avoid publishing teacher-only content to students.

Save Canvas object IDs, the associated hub course/unit IDs, source URLs, event dates, school time zone and last successful sync time. Update records by their Canvas IDs so repeated syncs do not duplicate them. Reconcile removed events only after a complete successful fetch. Keep the last successful data and clearly mark it stale when a sync fails.

Implement a **Sync now** action and a view of the imported schedule. A later scheduled job can use the same sync routine. This routine reads Canvas data; it does not need to write to Canvas.

References: [modules and items](https://developerdocs.instructure.com/services/canvas/resources/modules), [calendar events](https://developerdocs.instructure.com/services/canvas/resources/calendar_events), [pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination).

## 7. Prepare the Unit 9 demonstration

In the dummy course, create a Unit 9 module, a sample resource and lesson calendar events for March 15–19, 2027. Create any quiz deadline separately. Explicitly map that Canvas module and those lesson event IDs to the hub's AP Chemistry Unit 9.

The hub should display a planned teaching window of March 15–19, its schedule source and last successful sync time. A module unlock date is availability, and a quiz deadline is a deadline; neither alone establishes the teaching window.

## 8. Run the acceptance test

| Action in Canvas or the test setup | Expected hub behavior |
| --- | --- |
| Sync the initial course | Unit 9 and its scheduled lessons appear |
| Move lessons to March 22–26 | The next sync updates the planned teaching dates |
| Rename the module | Its ID-based unit/resource mapping remains intact |
| Remove a lesson event | The event disappears after a complete successful reconciliation |
| Sync again without changes | No duplicates appear |
| Revoke or expire the test token | Connection failure is shown; the successful-sync timestamp does not advance |
| Compare student and teacher visibility | Student views do not expose content the student cannot access |

Demonstrate edits in the actual dummy Canvas course followed by a successful hub sync. Record which cases passed and which remain unresolved before expanding the pilot.

Documentation reviewed September 15, 2026. Canvas permissions and available options depend on the school's configuration.
