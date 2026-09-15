# Study Commons

A portable starter for a school course hub, based on the dashboard and discussion-board concept. It uses plain HTML, CSS and JavaScript, with a dependency-free Node.js server.

**This is a deployable frontend prototype.** Course selections, questions, replies and resource suggestions are stored in the current browser's local storage. They survive refreshes, but they are not shared across students or devices. There are no accounts, school-membership checks or server-side moderation. Anyone who can access a published URL can view its example content.

Read the [product outline](docs/product-outline.md) for the school-specific design and the [Canvas pilot guide](docs/canvas-pilot.md) for the exact access, configuration and development needed to test a school-provided dummy course. Canvas synchronization is planned and is **not implemented in this starter**.

## Run locally

Install Node.js 22 or newer, open a terminal in this folder, and run:

```sh
npm start
```

Open `http://localhost:3000`. There are no packages to install and no build step. To use a different port, set the `PORT` environment variable. The server listens on `0.0.0.0` so hosts such as Replit can reach it.

## Import and publish on Replit

1. Open [Replit Import](https://replit.com/import), select **ZIP**, and upload `study-commons.zip`.
2. Import the project. Its root should contain `.replit`, `package.json`, `server.js` and `public/`.
3. Run the app. The included `.replit` uses `node server.js`. If Replit asks for a run command, use `npm start` or `node server.js`.
4. Check the app in Preview, then open **Publish**.
5. For **Autoscale**, use `node server.js` as the deployment run command. No build command is needed. Review the publishing settings in your Replit account before publishing.

You can also import a GitHub repository containing these files using the same Replit importer. This source package has not been deployed to your Replit account.

For a host that supports static publishing, publish the **contents of `public/`** as the site root. The Node server is only a static file server and is not needed for that option. Use a web server or host rather than opening `index.html` as a `file://` URL: the app uses JavaScript modules. This starter assumes it is hosted at the domain root, not a subdirectory.

Official references checked September 10, 2026: [Importing a project](https://docs.replit.com/build/import-from-providers), [project configuration](https://docs.replit.com/features/project-setup/configuration), [ports](https://docs.replit.com/features/project-setup/ports), and [publishing types](https://docs.replit.com/features/publishing/deployment-types).

## What's included

- A personal dashboard with course cards and a school course catalog.
- Working add/remove course controls; removing a card preserves that course's discussions.
- Course-specific resources and discussion pages.
- AP Chemistry's nine-module outline, links to official College Board materials, and one illustrative note.
- Example English, Algebra II and AP Biology entries. These are not your school's actual catalog. Biology is an empty course outline ready to customize.
- Expandable question threads, replies, topic tags, and answered/reopened states for questions created in this browser.
- Optional resource suggestions stored locally as pending. Suggestions are not sent to a moderator or automatically added to the library.
- Browser-local persistence, responsive layouts, keyboard-accessible controls, and system light/dark appearance.

## Edit your school and courses

Start with **`public/data.js`**:

- Change `school.name` to your school's name.
- Change `school.defaultCourseIds` to set the first-time dashboard selection.
- Replace the example courses with your school's course catalog.
- Give each course and module a stable, unique `id`.
- Tailor `units` to the course: they may be science units, books, writing skills, chapters or other topics.
- Add course-wide links to `links`.
- Add resources to `resources`, with a `unitId` matching one of the course's module IDs.
- Remove or replace `questions` to change the example discussions.

Example resource linked to a module:

```js
{
  id: 'unique-resource-id',
  unitId: 'unit-1',
  title: 'Atomic structure notes',
  type: 'Notes',
  source: 'Name of the resource creator',
  url: 'https://example.org/your-resource'
}
```

Use a `text` property instead of `url` to display a short note directly. Resource URLs must use `http:` or `https:`. Adding a new file under `public/` also requires adding its route and MIME type to the server's asset allowlist, or hosting it separately and linking to it.

Change colors, spacing and layout in **`public/styles.css`**. Application rendering and interactions live in **`public/app.js`**. The persistence and safe-text helpers live in **`public/state.js`**. No Codex APIs, visualization runtime, remote fonts or external JavaScript libraries are required.

### Reset demo state

Previously saved discussions override their initial example data. After editing examples, remove the `study-commons-demo-v1` local-storage key using your browser's developer tools, or change `school.storageKey` to a new name. Changing the key starts a fresh local demo without deleting the old key.

Browser storage is per browser and origin. Replit Preview and a published domain can therefore have different saved activity. If storage is blocked or full, the app continues for the current page session and displays a notice that changes could not be saved.

## Checks

```sh
npm run check
npm test
```

Checks cover JavaScript syntax, static asset responses, HEAD requests, unsupported methods, private-file protection, browser-state round trips, malformed saved state and safe URLs/text. They do not replace testing with actual students or constitute a browser accessibility audit.

## Turning it into a shared school application

The current Node server only serves files. For a real shared discussion board, replace the browser-local state layer with a server API and durable database, then add school sign-in and server-side authorization. Membership, ownership and moderator permissions must be checked on the server; the prototype's `mine` flag is only a display convention. Add the resource-review workflow and discussion reporting there as well.

Keep the school membership policy and content permissions explicit before sharing real student material. Files uploaded to a hosting workspace or written to a deployment filesystem are not a substitute for a durable shared database.

## Files

```text
.replit          Replit run and publishing configuration
.env.example     Placeholder settings for a future Canvas connector
package.json     Run and check commands; no dependencies
server.js        Static HTTP server and health endpoint
docs/
  product-outline.md  School hub design and implementation status
  canvas-pilot.md     Canvas test-course setup and sync test plan
public/
  index.html     Standalone page shell
  styles.css     Responsive appearance
  data.js        School, courses, modules and example content
  app.js         Dashboard, resources and discussion interactions
  state.js       Browser-local persistence and safe rendering helpers
test/
  app.test.js    Server and state checks
```
