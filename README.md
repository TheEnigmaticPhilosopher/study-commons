# Study Commons

A school course hub with a private, read-only Canvas backend. Plain HTML, CSS, JavaScript and Node.js. Local storage uses SQLite; Vercel deployments use private Blob storage.

The Canvas pilot discovers your available and completed courses and adds them to a private dashboard with their original modules and resource links. It works with fictional fixtures or your own Canvas account. A private pilot login protects synced content. The general school catalog remains public example content. Hub discussions, example dashboard selections and pending resource suggestions still use browser-local storage; they are not shared between students.

## Run locally

Use Node.js **24**. Run `pnpm install --frozen-lockfile` to install dependencies.

1. Copy `.env.example` to `.env` if you do not already have local settings.
2. Set `HUB_ADMIN_PASSWORD` to a unique password of at least 16 characters.
3. Leave `CANVAS_MODE=demo` to try fictional Chemistry and English courses without credentials.
4. Run `node server.js` (or `npm start`).
5. Open http://localhost:3000, select **Canvas connection**, and sign in with your demo password.
6. Select **Sync all Canvas courses**, then **Open your linked courses**. Both courses appear automatically.
7. Open Chemistry → **Calendar**, select Unit 9 for **Unit 9 teaching week**, and save the teaching link.
8. Open **Modules** and expand Unit 9 to see March 15–19, 2027 under **Scheduled teaching**. The other tabs list course-wide resource links.

Those dates and the demo course are fictional. Fictional Canvas links do not open a real school course.

## Connect your Canvas account

Follow the [step-by-step Canvas guide](docs/canvas-pilot.md). Set `CANVAS_MODE=live`, `CANVAS_BASE_URL`, and `CANVAS_ACCESS_TOKEN` privately, then restart. `CANVAS_COURSE_ID` is optional for account sync; it is used only by the single-course example-library mapping tool. The browser never receives your token. Never paste a token into chat, a GitHub file, or the demo login form.

Sync is manual: use **Sync all Canvas courses** after Canvas changes. A progress indicator tracks the import, and each category reports its last refresh and any access or request errors. To import from the terminal while no other sync is running, use `node scripts/sync-canvas.js`; optional start and end arguments select the calendar window, for example `node scripts/sync-canvas.js 2027-03-01 2027-03-31`. The CLI loads the same private settings and SQLite database as the server. Reload the app after a CLI import.

A personal token is for your own development test. A school rollout needs school approval and Canvas OAuth; this starter does not provide multiuser Canvas authentication. [Canvas authentication documentation](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth).

## Vercel

Follow the [Vercel personal-pilot guide](docs/vercel-pilot.md). Cloud deployments use persistent private storage and sessions, with resumable imports that process one course per request. Every `.env` file and local database is excluded from deployment. Production credentials belong in Vercel server secrets.

## Replit

1. Import this GitHub repository or its source ZIP into Replit.
2. Use Node 24, install dependencies, and use run command `node server.js`; there is no build command.
3. Add the settings from `.env.example` to **Replit Secrets**. Keep the workspace private when using real course data.
4. Set `APP_ORIGIN` to the exact HTTPS address at which you open the running app (scheme and hostname, no path). Preview and published addresses differ.
5. Run, open the app in its own tab, then sign in and sync. The app blocks embedding in other sites, so use the standalone tab for this pilot.
6. For a disposable published demonstration, use a **single instance**. Set the published `APP_ORIGIN` and deployment secrets before running.

SQLite saves snapshots and unit links in `data/study-commons.sqlite` on that machine. **The SQLite backend is a single-process pilot.** Sessions are held in memory and end on restart. Do not use multiple Autoscale instances: each would have different sessions and local data. Replit deployment filesystems are not a durable database; a deployment can lose saved mappings and snapshots. Use persistent storage, shared sessions, and school sign-in before a lasting school deployment. Publishing does not copy your workspace's synced data into a durable service.

The backend cannot run as a static-only website. This repository has not been deployed to your Replit account.

Official references: [Replit Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets), [publishing](https://docs.replit.com/cloud-services/deployments/about-deployments).

## What the Canvas backend does

- Discovers available and, optionally, completed courses accessible to your account.
- Imports visible modules/items, assignments, pages, file links, announcements, discussion topics, quizzes, and course calendar events in a chosen date range.
- Adds course cards and navigation automatically, preserving Canvas course/module IDs. Each course has its own resource tabs.
- Stores titles, IDs, source links and selected dates. It does not download file contents, page bodies, discussion replies or announcement bodies. New Quizzes may appear through assignments or modules rather than the Classic Quizzes list.
- Stores a normalized snapshot, stable teaching-event mappings and per-category refresh timestamps.
- Labels explicit, manually linked teaching events separately from module unlock dates and resource deadlines.
- Replaces successfully fetched categories to reflect changes/deletions. Temporary category failures retain older data with an explicit warning. A 403/404 clears that inaccessible category; failed discovery or a rejected token preserves the previous account snapshot and reports an error.
- Uses pagination with same-origin, same-endpoint checks, bounded responses and timeouts.
- Keeps imported content behind an HttpOnly session cookie. Mutations require a matching `APP_ORIGIN`.
- Omits grades, submissions, rosters, event descriptions, and appointment reservations.
- Makes **GET requests only** to Canvas. Sync and mapping changes write only to the hub's database.

A new Canvas token gets a separate local cache so one account cannot inherit another account's saved data. Re-link units after rotating a token. Old snapshots remain in the ignored database; remove the database while the app is stopped if you need to erase all pilot data.

## SALTY connector

Study Commons can remain separate while a future SALTY backend links to its saved resources through a dedicated read-only feed. See the [connector setup and boundary](docs/salty-connector.md). The endpoint is disabled until a separate connector key and explicit course allowlist are configured. It does not share the Canvas token, establish SALTY sign-in, or archive file contents.

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
- `public/canvas.js` — private connection screen, sync progress and legacy unit links.
- `public/canvas-account.js` — imported course dashboard, resource tabs and teaching links.
- `scripts/sync-canvas.js` — account import from the terminal using private settings.
- `public/app.js`, `data.js`, `state.js` — catalog, resources, local discussions.
- `docs/canvas-pilot.md` — personal/course demo setup and acceptance checklist.
- `docs/product-outline.md` — current scope and school rollout work.

Shared discussions, moderator approvals, school SSO, Canvas OAuth, automatic background sync and multi-section enrollment filtering remain future work.
