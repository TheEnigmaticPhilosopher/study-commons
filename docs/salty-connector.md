# Connect a separate SALTY backend

Study Commons remains the resource hub and Canvas API client. The separate SALTY connector reads a versioned, read-only projection of saved resources; it never receives the Canvas token. SALTY currently has no shared sign-in or application server. The connector is preparation for that host, not SSO or an installed school integration.

## Private configuration

Leave these values blank to disable the endpoint. To enable it for an authorized backend, configure a new random connector secret of at least 32 characters and an explicit course allowlist:

```dotenv
SALTY_CONNECTOR_TOKEN=
SALTY_COURSE_IDS=12345,23456
```

The IDs above are fictional. Use only the needed real course IDs for an authorized connection. Do not reuse the Canvas token or `HUB_ADMIN_PASSWORD`. Put the connector key in the SALTY host's server-only `STUDY_COMMONS_CONNECTOR_TOKEN`, and its hub URL in `STUDY_COMMONS_ORIGIN`. Restart Study Commons after changing configuration. The token and allowlist are not exposed to the browser or saved in SQLite.

## Read-only API

```http
GET /api/integrations/salty/courses?course_id=12345&course_id=23456
Authorization: Bearer <separate connector key>
```

Requests must name one to 150 numeric course IDs. Every requested ID must be on the server allowlist; otherwise the entire request is denied. The key permits no other private endpoint, sign-in, sync, or mapping write. The feed never contacts Canvas; it reads the current saved snapshot. Run the normal Canvas account sync first and after source changes.

Version 1 returns `schemaVersion`, `mode`, provider instance, hub origin, scope, unavailable IDs, sync status, and course resources. Original IDs, module membership, teaching links, per-category warnings, original Canvas URLs and matching Study Commons routes are retained. A source reference is scoped by Canvas instance, course ID, entity type and external ID. It does not create a SALTY person or infer course equivalence from a title.

An HTTP 200 can describe `not_synced`, `running`, `complete`, `partial`, or `failed` data. Preserve these states and timestamps in the consumer. `complete` is limited to the requested resource categories and calendar window. Missing records are not proof of deletion. This feed contains links and selected metadata, not grades, submissions, page bodies, discussion replies or archived file bytes.

The SALTY repository's `integrations/study-commons/contract.mjs` is the executable consumer contract; its client requires a host authorization callback before making requests. The host must derive the principal from its verified server session and map course references to authorized sections. No default allow policy or shared SALTY identity is supplied by this pilot.

## Verification

Run `node --test test/salty.test.js` here. In the SALTY checkout, run `node integrations/study-commons/verify-provider.mjs ../study-commons` with this checkout's path. That command verifies both repositories together using fictional Canvas data, an ephemeral loopback server and in-memory SQLite; it loads no private `.env` file.
