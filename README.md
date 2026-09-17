# Study Commons

A school course hub with a private, read-only Canvas backend. Plain HTML, CSS, JavaScript and Node.js; no third-party runtime packages or build step.

The Canvas pilot now works with either fictional fixtures or one real course accessible to your own Canvas account. A private demo login protects synced content. The general school catalog remains public example content. Discussions, dashboard selections and pending resource suggestions still use browser-local storage; they are not shared between students.

## Run locally

Use Node.js **22.13 or newer** (Node 24 recommended). The built-in SQLite module may display an experimental warning on some Node versions.

1. Copy `.env.example` to `.env` if you do not already have local settings.
2. Set `HUB_ADMIN_PASSWORD` to a unique password of at least 16 characters.
3. Leave `CANVAS_MODE=demo` to try the fictional AP Chemistry course without credentials.
4. Run `node server.js` (or `npm start`).
5. Open http://localhost:3000, select **Canvas connection**, and sign in with your demo password.
6. Select **Sync now**, expand Unit 9, and link its module to AP Chemistry → Unit 9.
7. Link the **Unit 9 teaching week** calendar event to the same unit. Open AP Chemistry to see the schedule and Canvas resources.
8. Return to Canvas connection, select the rescheduled scenario, and sync again. The teaching dates change from March 15–19 to March 22–26, 2027.

Those dates and the demo course are fictional. Fictional Canvas links do not open a real school course.

## Connect your own Canvas course

Follow the [step-by-step Canvas guide](docs/canvas-pilot.md). Set `CANVAS_MODE=live`, `CANVAS_BASE_URL`, `CANVAS_COURSE_ID`, and `CANVAS_ACCESS_TOKEN` privately, then restart. The browser never receives your token. Never paste a token into chat, a GitHub file, or the demo login form.

A personal token is for your own development test. A school rollout needs school approval and Canvas OAuth; this starter does not provide multiuser Canvas authentication. [Canvas authentication documentation](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth).

## Replit

1. Import this GitHub repository or its source ZIP into Replit.
2. Use Node 22.13+ and run command `node server.js`; there is no build command.
3. Add the settings from `.env.example` to **Replit Secrets**. Keep the workspace private when using real course data.
4. Set `APP_ORIGIN` to the exact HTTPS address at which you open the running app (scheme and hostname, no path). Preview and published addresses differ.
5. Run, open the app in its own tab, then sign in and sync. The app blocks embedding in other sites, so use the standalone tab for this pilot.
6. For a disposable published demonstration, use a **single instance**. Set the published `APP_ORIGIN` and deployment secrets before running.

SQLite saves snapshots and unit links in `data/study-commons.sqlite` on that machine. **The current backend is a single-process pilot.** Sessions are held in memory and end on restart. Do not use multiple Autoscale instances: each would have different sessions and local data. Replit deployment filesystems are not a durable database; a deployment can lose saved mappings and snapshots. Use a persistent database (such as PostgreSQL), shared sessions, and school sign-in before a lasting school deployment. Publishing does not copy your workspace's synced data into a durable service.

The backend cannot run as a static-only website. This repository has not been deployed to your Replit account.

Official references: [Replit Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets), [publishing](https://docs.replit.com/cloud-services/deployments/about-deployments).

## What the Canvas backend does

- Reads only the configured course, published/visible modules and module items, and course calendar events in a chosen date range.
- Stores a normalized snapshot, stable ID mappings, last attempt and last successful sync.
- Labels explicit, manually linked teaching events separately from module unlock dates and resource deadlines.
- Reconciles changed/deleted records after a complete sync; preserves the last good snapshot if any request fails.
- Uses pagination with same-origin, same-endpoint checks, bounded responses and timeouts.
- Keeps imported content behind an HttpOnly session cookie. Mutations require a matching `APP_ORIGIN`.
- Omits grades, submissions, rosters, event descriptions, and appointment reservations.
- Makes **GET requests only** to Canvas. Sync and mapping changes write only to the hub's database.

A new Canvas token gets a separate local cache so one account cannot inherit another account's saved data. Re-link units after rotating a token. Old snapshots remain in the ignored database; remove the database while the app is stopped if you need to erase all pilot data.

## Customize the school library

Edit `public/data.js`: school name, catalog, units, resources and example discussions. AP Chemistry has nine units; other subjects can use different structures. Resource entries support a URL or short inline text, plus creator/source and unit ID. The catalog is illustrative, not a verified list of your school's courses.

Edit `public/styles.css` for appearance. Add new public files to the explicit asset allowlist in `server.js`. Never add configuration files or database paths to that allowlist.

## Verification

```sh
npm run check
npm test
```

Or run `node scripts/check.js` and `node --test` directly. Tests use synthetic Canvas responses, never real credentials. They exercise auth/origin checks, token non-disclosure, pagination, rescheduling, stable mappings, deletion, failed partial syncs, SQLite persistence, and existing browser-state behavior. A live-course acceptance test still requires your privately configured credentials.

## Project structure

- `server.js` — HTTP server, public asset allowlist, private API routing.
- `lib/config.js` — environment configuration and validation.
- `lib/canvas.js` — read-only Canvas client and fictional fixture adapter.
- `lib/store.js` — SQLite snapshot storage.
- `lib/api.js` — login, sessions, sync and unit mappings.
- `public/canvas.js` — private connection screen and scheduled unit resources.
- `public/app.js`, `data.js`, `state.js` — catalog, resources, local discussions.
- `docs/canvas-pilot.md` — personal/course demo setup and acceptance checklist.
- `docs/product-outline.md` — current scope and school rollout work.

Shared discussions, moderator approvals, school SSO, Canvas OAuth, automatic background sync and multi-section enrollment filtering remain future work.
