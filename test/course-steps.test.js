import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasClient, accountDemoFetch, CanvasError } from '../lib/canvas.js';
import { readConfig } from '../lib/config.js';

const range = ['2027-03-01', '2027-03-31'];
const config = readConfig({});

test('discovery returns only safe course metadata suitable for a persisted queue', async () => {
  const requests = [];
  const client = createCanvasClient(config, async input => {
    const url = new URL(input); requests.push(url);
    return Response.json([
      { id: 12345, name: 'Chemistry', course_code: 'CHEM', workflow_state: 'available', time_zone: 'America/Los_Angeles',
        term: { name: '2026–27', private_value: 'omit-me' }, enrollments: [{ grades: { final_score: 99 } }],
        syllabus_body: '<p>private syllabus</p>', html_url: 'https://foreign.example/course' },
      { id: 77, name: 'Unpublished', workflow_state: 'unpublished' },
      { id: 78, name: 'Deleted', workflow_state: 'deleted' },
    ]);
  });
  assert.deepEqual(await client.discoverCourses({ includeCompleted: false }), [{
    id: '12345', name: 'Chemistry', code: 'CHEM', state: 'available', term: '2026–27', timeZone: 'America/Los_Angeles',
    url: 'https://canvas.example.test/courses/12345', syllabusUrl: 'https://canvas.example.test/courses/12345/assignments/syllabus',
  }]);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].searchParams.getAll('state[]'), ['available']);
});

test('one course can resume from serialized discovery without another discovery request', async () => {
  const fixture = accountDemoFetch(); const requests = [];
  const client = createCanvasClient(config, async (input, options) => {
    const url = new URL(input); requests.push(url);
    const response = await fixture(input, options);
    if (url.pathname.endsWith('/modules/109/items')) {
      const items = await response.json();
      items[0].content_details = { due_at: '2027-03-19T23:00:00Z', unlock_at: '2027-03-15T12:00:00Z', locked_for_user: true };
      items[0].content_id = 71;
      return Response.json(items);
    }
    return response;
  });
  const courses = JSON.parse(JSON.stringify(await client.discoverCourses()));
  requests.length = 0;
  const saved = await client.syncCourse(courses[1], ...range);
  assert.equal(saved.course.id, '23456');
  assert.equal(saved.warnings.length, 0);
  assert.equal(saved.modules[0].items[0].dueAt, '2027-03-19T23:00:00Z');
  assert.equal(saved.modules[0].items[0].unlockAt, '2027-03-15T12:00:00Z');
  assert.equal(saved.modules[0].items[0].locked, true);
  assert.equal(saved.modules[0].items[0].contentId, '71');
  assert.equal(saved.files[0].url, 'https://canvas.example.test/courses/23456/files/81');
  assert.ok(requests.length > 0);
  assert.ok(requests.every(url => url.pathname.startsWith('/api/v1/courses/23456/') ||
    (url.pathname === '/api/v1/calendar_events' && url.searchParams.get('context_codes[]') === 'course_23456')));
});

test('per-course failures preserve matching stale categories and clear denied or differently scoped data', async () => {
  const fixture = accountDemoFetch(); let fail = false;
  const client = createCanvasClient(config, async (input, options) => {
    const path = new URL(input).pathname;
    if (fail && path.endsWith('/files')) return Response.json({ secret: 'private-error' }, { status: 403 });
    if (fail && (path.endsWith('/pages') || path.endsWith('/calendar_events'))) return Response.json({}, { status: 503 });
    return fixture(input, options);
  });
  const [chemistry, english] = await client.discoverCourses();
  const previousRecord = await client.syncCourse(chemistry, ...range);
  fail = true;
  const next = await client.syncCourse(chemistry, ...range, { previousRecord });
  assert.deepEqual(next.pages, previousRecord.pages);
  assert.deepEqual(next.events, previousRecord.events);
  assert.equal(next.collections.pages.syncedAt, previousRecord.collections.pages.syncedAt);
  assert.equal(next.collections.pages.status, 'failed');
  assert.equal(next.collections.files.status, 'unavailable');
  assert.equal(next.files.length, 0);
  assert.equal(next.warnings.length, 3);
  assert.equal(JSON.stringify(next).includes('private-error'), false);
  const changedWindow = await client.syncCourse(chemistry, '2027-04-01', '2027-04-30', { previousRecord });
  assert.equal(changedWindow.events.length, 0);
  const otherCourse = await client.syncCourse(english, ...range, { previousRecord });
  assert.equal(otherCourse.pages.length, 0);
  assert.equal(otherCourse.collections.pages.syncedAt, null);
  assert.equal(otherCourse.syncedAt, null);
});

test('resumed metadata cannot supply foreign links or extra private fields', async () => {
  const client = createCanvasClient(config, accountDemoFetch());
  const [course] = await client.discoverCourses();
  const record = await client.syncCourse({ ...course, url: 'https://foreign.example', syllabusUrl: 'https://foreign.example',
    enrollments: [{ grades: 'private-grade' }], syllabus_body: 'private-body' }, ...range);
  assert.deepEqual(record.course, course);
  await assert.rejects(() => client.syncCourse({ id: '../users' }, ...range), /invalid record ID/);
});

test('authentication failure aborts the course instead of saving a partial import', async () => {
  const fixture = accountDemoFetch(); const paths = [];
  const client = createCanvasClient(config, async (input, options) => {
    const path = new URL(input).pathname; paths.push(path);
    if (path.endsWith('/pages')) return Response.json({}, { status: 401 });
    return fixture(input, options);
  });
  const [course] = await client.discoverCourses();
  await assert.rejects(() => client.syncCourse(course, ...range), error => error instanceof CanvasError && error.status === 401);
  assert.equal(paths.some(path => path.endsWith('/files')), false);
});

test('discovery and each course obey the supplied abort signal without continuing requests', async () => {
  let requests = 0;
  const stopped = createCanvasClient(config, async () => { requests++; return Response.json([]); });
  await assert.rejects(() => stopped.discoverCourses({ signal: AbortSignal.abort() }), /stopped|time limit/);
  await assert.rejects(() => stopped.syncCourse({ id: '12345' }, ...range, { signal: AbortSignal.abort() }), /stopped|time limit/);
  assert.equal(requests, 0);

  const controller = new AbortController();
  const fixture = accountDemoFetch();
  const client = createCanvasClient(config, async (input, options) => {
    requests++;
    assert.ok(options.signal instanceof AbortSignal);
    const response = await fixture(input, options);
    controller.abort();
    return response;
  });
  await assert.rejects(() => client.syncCourse({ id: '12345', name: 'Chemistry' }, ...range, { signal: controller.signal }), /stopped|time limit/);
  assert.equal(requests, 1);
});
