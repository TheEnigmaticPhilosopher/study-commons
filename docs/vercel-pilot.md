# Vercel personal pilot

Deployment: [study-commons-pilot.vercel.app](https://study-commons-pilot.vercel.app/#canvas). Imported courses require the existing personal pilot password.

The public library contains approved course names and curated publisher links. Sign in with the personal pilot password to see private Canvas class metadata and original material links. Displayed grades are fictional samples. The separate SALTY connector remains disabled until explicitly configured.

## Setup

Use Node 24 and install pinned dependencies with `pnpm install --frozen-lockfile`. Vercel runs `api/index.js` as a Node function using the same request handler as the local server. There is no frontend build step.

1. Run `pnpm exec vercel login` and approve its device login in your browser.
2. Run `pnpm exec vercel project add study-commons-pilot`, then `pnpm exec vercel link --project study-commons-pilot --yes`. Choose a different project name if necessary.
3. Create and connect a **private** store: `pnpm exec vercel blob create-store study-commons-private --access private --yes --environment production`. Review the account's plan and included usage before accepting any paid upgrade. The connection supplies `BLOB_STORE_ID` for managed storage credentials.
4. Set production environment values below. If `.env` is privately configured locally, run `node scripts/configure-vercel.js`. It sends only allowed individual values through CLI stdin, suppresses provider output, and never uploads the file. Alternatively enter them in Vercel's environment settings.
5. Run `pnpm exec vercel --prod`. Keep Fluid Compute enabled and Node 24 selected. `vercel.json` sets the function limit to 300 seconds.
6. Open the **production domain**, sign in with the existing personal pilot password, choose calendar dates, and select **Sync all Canvas courses**.

| Production setting | Value |
| --- | --- |
| `CANVAS_MODE` | `live` |
| `CANVAS_BASE_URL` | School Canvas HTTPS origin, without a course path |
| `CANVAS_ACCESS_TOKEN` | Personal Canvas token; save as a Secret |
| `HUB_ADMIN_PASSWORD` | Separate pilot password of at least 16 characters; save as a Secret |
| `STORAGE_DRIVER` | `blob` |
| `BLOB_STORE_ID` | Supplied by the connected private store |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`, to use the pinned pnpm version |
| `APP_ORIGIN` | Optional exact production HTTPS origin; defaults to Vercel's production domain |

The SDK also supports `BLOB_READ_WRITE_TOKEN` for stores using that credential. Keep it a server Secret. Preview domains cannot make changes unless configured as the app origin; use the production domain for this pilot.

## Import and privacy

The cloud importer discovers courses, processes one course per request, and saves a private checkpoint after each step. Keep the app open while importing. Reopening it resumes the saved job. A failed step shows **Resume import** and retains the previous successful snapshot. Unusually large courses can still exceed the per-request timeout and need a smaller import strategy.

To run or resume the same hosted import from a privately configured checkout, use `node scripts/sync-hosted.js https://study-commons-pilot.vercel.app 2026-08-01 2027-07-31`. This sends the hub password only to the supplied HTTPS origin, prints progress and counts, and revokes its session afterward. An existing job retains its original calendar range.

Snapshots, teaching links, progress, login throttling, and sessions use private Blob storage. Conditional writes prevent concurrent requests from losing updates. Sign-in survives new server instances. Logout revokes the session; sessions expire after eight hours. Rotating the password or Canvas token invalidates previous sessions. A changed Canvas token starts a separate account cache.

Imports include accessible resource metadata and original links, without downloading files, page bodies, grades, submissions, or rosters. Canvas permission errors appear as category warnings. Deadlines and module unlock dates do not establish a teaching week; link actual teaching events explicitly.

Assignment submissions are a separate confirmed action: open a course's Assignments tab and select Prepare submission. The live editor supports text, website URLs and one file up to 3 MiB; unsupported workflows open in Canvas. See [Canvas submission behavior](canvas-submissions.md). Only allow the token owner to use this personal pilot.

`.vercelignore` excludes every `.env` file, SQLite databases, local data, logs, archives, and local tooling. `.gitignore` excludes private `.env` files and database state. Never deploy with Vercel's `--public` source option. The app serves only explicitly allowed public assets; the private API requires login.

This is a single-user personal pilot. Shared school discussions, student accounts, moderation, school SSO, and scheduled imports are not implemented.

## Verification

Run `node scripts/check.js` and `node --test`. On the deployed domain, check `/health` returns `{"status":"ok"}`, `/api/canvas` requires sign-in, and `/.env`, `/server.js`, and `/data/study-commons.sqlite` return 404. After import, reload and verify courses persist, original links open the correct Canvas course, and sign-out blocks private data.

References: [Node HTTP servers](https://vercel.com/docs/functions/runtimes/node-js), [private Blob storage](https://vercel.com/docs/vercel-blob/private-storage), [package managers](https://vercel.com/docs/package-managers), [function duration](https://vercel.com/docs/functions/configuring-functions/duration).
