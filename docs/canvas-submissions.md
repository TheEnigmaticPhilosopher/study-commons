# Canvas assignment submissions

The personal pilot can send text entries, website URLs, or one file up to 3 MiB to the connected Canvas token owner's account. Open an imported course's Assignments tab, choose Prepare submission, read the original instructions in Canvas, prepare your draft, review, check the confirmation box, and select Submit to Canvas. A successful response displays Canvas's attempt number and submission time. Displayed grades elsewhere remain fictional; no real grade fields are returned or stored by this feature.

The editor keeps drafts in tab memory, not localStorage. Leaving or reloading loses the draft. Keep a separate copy. The server stores a content hash, review ID, attempt number and receipt, never the draft body or uploaded file bytes. During review and submission the content is transmitted to the private hub server; only the final confirmed action sends it to Canvas. A file may remain uploaded in Canvas if its subsequent submission fails.

## Eligibility and boundaries

- The course and assignment must exist in the private imported snapshot. Current assignment details are fetched again when opening, reviewing and submitting. Canvas's `can_submit` checks enrollment, locks and attempts.
- Group assignments, quizzes, external tools, annotations, media recording, integrity pledges, and known plagiarism-tool workflows use Canvas's original interface. Reading full instructions also opens Canvas; instructor HTML is not rendered in the hub.
- File extensions are checked against the current assignment. Uploads support same-origin Canvas destinations and standard HTTPS Amazon S3 hosts. Other storage hosts, multiple files and larger files use Canvas. Signed file uploads never receive the Canvas bearer token; upload confirmation must return to the configured Canvas origin.
- Confirmation only submits as the token owner. The API never accepts a user ID, supplied file ID, impersonation option or backdated submission time. Do not share this personal pilot password with other students. A school deployment requires per-student authentication and Canvas OAuth.
- Demo mode never submits or uploads anything. Automated tests use mock Canvas responses. A real write acceptance test requires a selected test assignment and deliberately reviewed work.

## Delivery and retries

Reviews expire after ten minutes and are bound to the exact content and current Canvas attempt. Changed content, a new review or a new Canvas attempt requires review again. A durable atomic claim allows one send per review, including concurrent Vercel requests. Repeating a completed request returns its stored receipt rather than resubmitting.

Canvas does not provide an idempotency key for assignment submissions. After a timeout or ambiguous result, Study Commons blocks automatic retry and directs the student to inspect Canvas. If Canvas later shows a higher attempt, refreshing status can allow a new review, but that higher attempt is not represented as proof that the uncertain draft arrived. If a server terminates during sending, use Canvas directly; no automatic recovery sends work again.

## API and verification

Authenticated endpoints, all with no-store responses:

- `GET /api/canvas/assignments/:course/:assignment`: current eligibility, selected metadata and allowlisted submission status.
- `POST .../prepare`: validates a draft and creates a server-side review; does not write to Canvas.
- `POST .../submit`: requires the review ID, unchanged draft, same-origin request, and `confirm: true`.

Both local and Vercel handlers enforce session authentication and origin checks. The JSON limit is expanded only for these submission endpoints. Tests cover both handlers, text escaping, URL validation, file limits, upload redirects and credential isolation, missing confirmation, stale reviews, double clicks, uncertain delivery, and stripping real grades.

Canvas references: [Submissions API](https://developerdocs.instructure.com/services/canvas/resources/submissions), [assignment eligibility](https://developerdocs.instructure.com/services/canvas/resources/assignments), [file upload protocol](https://developerdocs.instructure.com/services/canvas/basics/file.file_uploads).
