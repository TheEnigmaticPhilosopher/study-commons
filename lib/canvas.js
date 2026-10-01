import { normalizeGrades } from './grades.js';

export class CanvasError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

const text = value => typeof value === 'string' ? value.slice(0, 500) : '';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const id = value => {
  if (!/^\d+$/.test(String(value))) throw new CanvasError('Canvas returned an invalid record ID.');
  return String(value);
};
const unique = values => [...new Map(values.map(value => [value.id, value])).values()];

export function validateRange(start, end) {
  for (const value of [start, end]) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new CanvasError('Choose valid start and end dates.');
    }
  }
  const days = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (days < 0 || days > 370) throw new CanvasError('Choose a date range of at most 370 days, with the end after the start.');
  return { start, end };
}

export function createCanvasClient(config, fetcher = fetch) {
  const base = config.baseUrl;
  const coursePath = `/api/v1/courses/${config.courseId}`;
  function publicLink(value) {
    try {
      const url = new URL(value);
      return url.origin === base && !url.username && !url.password && !url.searchParams.has('access_token') ? url.href : null;
    } catch { return null; }
  }
  async function request(url, signal) {
    if (signal.aborted) throw new CanvasError('The sync was stopped or exceeded its time limit.');
    let response;
    try {
      response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' } });
    } catch { throw new CanvasError('Canvas could not be reached or the request timed out. Check the server configuration and try again.'); }
    if (!response.ok) {
      const messages = {
        401: 'Canvas rejected the access token. Replace it privately in your server settings.',
        403: 'Your Canvas account does not have permission to read this course or endpoint.',
        404: 'Canvas could not find this course or one of its modules.',
        429: 'Canvas is rate limiting requests. Wait a minute, then sync again.',
      };
      throw new CanvasError(messages[response.status] || 'Canvas returned an unexpected response. Try again later.', response.status);
    }
    let payload;
    try {
      // Bound the response size while reading, rather than buffering an arbitrary body.
      const reader = response.body.getReader();
      const parts = []; let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 8 * 1024 * 1024) { await reader.cancel(); throw Error('too large'); }
          parts.push(value);
        }
      } finally { reader.releaseLock(); }
      payload = JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch { throw new CanvasError('Canvas returned an unreadable or oversized response.'); }
    if (signal.aborted) throw new CanvasError('The sync was stopped or exceeded its time limit.');
    return { payload, link: response.headers.get('link') || '' };
  }
  async function list(path, params, signal) {
    const first = new URL(path, base);
    const fixed = Object.entries(params).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(item => [key, item]));
    first.search = new URLSearchParams([...fixed, ['per_page', '100']]).toString();
    let next = first;
    const seen = new Set(); const values = [];
    while (next) {
      if (next.origin !== base || next.pathname !== first.pathname || next.username || next.password || next.searchParams.has('access_token')) {
        throw new CanvasError('Canvas returned an unsafe pagination link. Sync was stopped.');
      }
      // Keep the explicit course and date filters even if a pagination link omits them.
      for (const key of Object.keys(params)) next.searchParams.delete(key);
      for (const [key, value] of fixed) next.searchParams.append(key, value);
      if (seen.has(next.href) || seen.size >= 100) throw new CanvasError('Canvas pagination exceeded the safe limit. Narrow the date range.');
      seen.add(next.href);
      const { payload, link } = await request(next, signal);
      if (!Array.isArray(payload)) throw new CanvasError('Canvas returned an unexpected list.');
      values.push(...payload);
      const match = [...link.matchAll(/<([^>]+)>\s*;[^,]*?rel="?([^";,]+)"?/g)].find(item => item[2].split(/\s+/).includes('next'));
      try { next = match ? new URL(match[1], base) : null; }
      catch { throw new CanvasError('Canvas returned an invalid pagination link.'); }
    }
    return values;
  }
  const client = {
    async syncGrades(courseId, { signal = AbortSignal.timeout(120000) } = {}) {
      courseId = id(courseId);
      const { payload: self } = await request(new URL('/api/v1/users/self/profile', base), signal);
      const selfId = id(self.id);
      const enrollments = await list(`/api/v1/courses/${courseId}/enrollments`, {
        user_id: selfId, 'type[]': 'StudentEnrollment', 'state[]': ['active', 'completed', 'inactive'] }, signal);
      const own = enrollments.some(item => String(item.user_id) === selfId && String(item.course_id) === courseId && item.type === 'StudentEnrollment');
      const assignments = own ? await list(`/api/v1/courses/${courseId}/assignments`, { 'include[]': 'submission' }, signal) : [];
      return normalizeGrades(courseId, selfId, enrollments, assignments, base);
    },
    async sync(start, end) {
      const range = validateRange(start, end);
      const signal = AbortSignal.timeout(120000);
      const { payload: course } = await request(new URL(coursePath, base), signal);
      if (!course || id(course.id) !== config.courseId) throw new CanvasError('Canvas returned a different course than configured.');
      const rawModules = await list(`${coursePath}/modules`, {}, signal);
      if (rawModules.length > 200) throw new CanvasError('This pilot supports up to 200 modules per course.');
      const modules = [];
      for (const module of rawModules) {
        if (module.published === false) continue;
        const moduleId = id(module.id);
        const items = await list(`${coursePath}/modules/${moduleId}/items`, { 'include[]': 'content_details' }, signal);
        modules.push({ id: moduleId, name: text(module.name), unlockAt: date(module.unlock_at), items: unique(items.filter(item => item.published !== false).map(item => ({
          id: id(item.id), title: text(item.title), type: text(item.type), url: publicLink(item.html_url),
          dueAt: date(item.content_details?.due_at), unlockAt: date(item.content_details?.unlock_at),
          locked: item.content_details?.locked_for_user === true,
        }))) });
      }
      const rawEvents = await list('/api/v1/calendar_events', { 'context_codes[]': `course_${config.courseId}`, type: 'event', start_date: start, end_date: end }, signal);
      const events = unique(rawEvents.filter(event => !event.hidden && event.workflow_state !== 'deleted' && !event.appointment_group_id &&
        (event.context_code === `course_${config.courseId}` || event.effective_context_code === `course_${config.courseId}`))
        .map(event => ({ id: id(event.id), title: text(event.title), startAt: date(event.start_at), endAt: date(event.end_at),
          allDay: Boolean(event.all_day), allDayDate: date(event.all_day_date), url: publicLink(event.html_url), context: text(event.context_code) })));
      return { course: { id: id(course.id), name: text(course.name), timeZone: text(course.time_zone) || 'UTC', url: `${base}/courses/${config.courseId}` }, modules: unique(modules), events, range, syncedAt: new Date().toISOString() };
    },
    async discoverCourses({ includeCompleted = true, signal = AbortSignal.timeout(120000) } = {}) {
      const states = includeCompleted ? ['available', 'completed'] : ['available'];
      const listed = unique((await list('/api/v1/courses', { 'state[]': states, 'include[]': 'term' }, signal))
        .filter(course => course && course.workflow_state !== 'deleted' && course.workflow_state !== 'unpublished')
        .map(course => {
          const courseId = id(course.id);
          const courseUrl = `${base}/courses/${courseId}`;
          return { id: courseId, name: text(course.name) || `Course ${courseId}`, code: text(course.course_code),
            state: text(course.workflow_state), term: text(course.term?.name), timeZone: text(course.time_zone) || 'UTC',
            url: courseUrl, syllabusUrl: `${courseUrl}/assignments/syllabus` };
        }));
      if (listed.length > 150) throw new CanvasError('More than 150 courses were found. Try excluding completed courses for this personal pilot.');
      return listed;
    },
    async syncCourse(course, start, end, { previousRecord = null, signal = AbortSignal.timeout(220000) } = {}) {
      const range = validateRange(start, end);
      if (signal.aborted) throw new CanvasError('The sync was stopped or exceeded its time limit.');
      const courseId = id(course?.id);
      const path = `/api/v1/courses/${courseId}`;
      const courseUrl = `${base}/courses/${courseId}`;
      const old = previousRecord?.course?.id === courseId ? previousRecord : null;
      // Rebuild the allowlisted metadata and URLs when resuming a persisted queue.
      const result = { course: { id: courseId, name: text(course.name) || `Course ${courseId}`, code: text(course.code),
        state: text(course.state), term: text(course.term), timeZone: text(course.timeZone) || 'UTC',
        url: courseUrl, syllabusUrl: `${courseUrl}/assignments/syllabus` }, range, collections: {}, warnings: [], syncedAt: null };
      async function collect(key, load) {
        try {
          result[key] = await load();
          result.collections[key] = { status: 'synced', syncedAt: new Date().toISOString(), count: result[key].length };
        } catch (error) {
          if (signal.aborted || error.status === 401) throw error;
          if (!(error instanceof CanvasError)) throw new CanvasError('Canvas returned an unexpected record. The previous account snapshot was kept.');
          const denied = [403, 404].includes(error.status);
          const compatible = key !== 'events' || (old?.range?.start === start && old?.range?.end === end);
          result[key] = !denied && compatible ? (old?.[key] || []) : [];
          result.collections[key] = { status: denied ? 'unavailable' : 'failed',
            syncedAt: !denied && compatible ? (old?.collections?.[key]?.syncedAt || null) : null, error: error.message, count: result[key].length };
          result.warnings.push(`${key}: ${error.message}`);
        }
      }
      const resource = (item, type, fallback) => ({ id: id(item.id ?? item.page_id), title: text(item.name || item.title || item.display_name || item.filename), type,
        url: publicLink(item.html_url) || fallback, dueAt: date(item.due_at), unlockAt: date(item.unlock_at), updatedAt: date(item.updated_at || item.posted_at),
        locked: item.locked_for_user === true || item.locked === true || item.hidden_for_user === true });
      await collect('modules', async () => {
        const modules = await list(`${path}/modules`, {}, signal);
        if (modules.length > 200) throw new CanvasError('This pilot supports up to 200 modules per course.');
        const normalized = [];
        for (const module of modules) {
          if (module.published === false) continue;
          const moduleId = id(module.id);
          const items = await list(`${path}/modules/${moduleId}/items`, { 'include[]': 'content_details' }, signal);
          normalized.push({ id: moduleId, name: text(module.name), unlockAt: date(module.unlock_at),
            items: unique(items.filter(item => item.published !== false).map(item => ({ ...resource({ ...item, ...item.content_details }, text(item.type), `${courseUrl}/modules/items/${id(item.id)}`),
              contentId: item.content_id == null ? null : id(item.content_id) }))) });
        }
        return unique(normalized);
      });
      const endpoints = [
        ['assignments', 'assignments', {}, 'Assignment', item => `${courseUrl}/assignments/${id(item.id)}`],
        ['pages', 'pages', {}, 'Page', item => `${courseUrl}/pages/${encodeURIComponent(String(item.url || item.page_id))}`],
        ['files', 'files', {}, 'File', item => `${courseUrl}/files/${id(item.id)}`],
        ['announcements', 'discussion_topics', { only_announcements: 'true' }, 'Announcement', item => `${courseUrl}/discussion_topics/${id(item.id)}`],
        ['discussions', 'discussion_topics', { only_announcements: 'false' }, 'Discussion', item => `${courseUrl}/discussion_topics/${id(item.id)}`],
        ['quizzes', 'quizzes', {}, 'Quiz', item => `${courseUrl}/quizzes/${id(item.id)}`],
      ];
      for (const [key, endpoint, params, type, fallback] of endpoints) {
        await collect(key, async () => unique((await list(`${path}/${endpoint}`, params, signal))
          .filter(item => item.published !== false && item.workflow_state !== 'deleted' && (key !== 'discussions' || !item.is_announcement))
          .map(item => resource(item, type, fallback(item)))));
      }
      await collect('events', async () => unique((await list('/api/v1/calendar_events', {
        'context_codes[]': `course_${courseId}`, type: 'event', start_date: start, end_date: end }, signal))
        .filter(event => !event.hidden && event.workflow_state !== 'deleted' && !event.appointment_group_id &&
          (event.context_code === `course_${courseId}` || event.effective_context_code === `course_${courseId}`))
        .map(event => ({ id: id(event.id), title: text(event.title), startAt: date(event.start_at), endAt: date(event.end_at), allDay: Boolean(event.all_day),
          allDayDate: date(event.all_day_date), url: publicLink(event.html_url) || `${base}/calendar?event_id=${id(event.id)}` }))));
      result.syncedAt = result.warnings.length ? (old?.syncedAt || null) : new Date().toISOString();
      result.attemptedAt = new Date().toISOString();
      return result;
    },
    async syncAccount(start, end, { includeCompleted = true, previous = null, onProgress = () => {}, signal = AbortSignal.timeout(900000) } = {}) {
      const range = validateRange(start, end);
      const listed = await client.discoverCourses({ includeCompleted, signal });
      const imported = [];
      const startedAt = new Date().toISOString();
      onProgress({ completed: 0, total: listed.length, currentCourse: '' });
      for (const course of listed) {
        if (signal.aborted) throw new CanvasError('The sync was stopped or exceeded its time limit.');
        onProgress({ completed: imported.length, total: listed.length, currentCourse: course.name });
        imported.push(await client.syncCourse(course, start, end, {
          previousRecord: previous?.courses?.find(item => item.course.id === course.id), signal,
        }));
        onProgress({ completed: imported.length, total: listed.length, currentCourse: '' });
      }
      return { version: 1, courses: imported, range, includeCompleted, startedAt, completedAt: new Date().toISOString(),
        warnings: imported.reduce((count, course) => count + course.warnings.length, 0) };
    },
  };
  return client;
}

// This fixture travels through the real parser and sync pipeline without network access.
export function demoFetch(scenario = 'original') {
  return async input => {
    const url = new URL(input);
    const root = '/api/v1/courses/12345';
    let data;
    if (url.pathname === root) data = { id: 12345, name: 'AP Chemistry · Fictional demo course', time_zone: 'America/Los_Angeles' };
    else if (url.pathname === `${root}/modules`) data = Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, name: `Unit ${i + 1}${i === 8 ? ': Thermodynamics and electrochemistry' : ''}`, published: true }));
    else if (/\/modules\/\d+\/items$/.test(url.pathname)) {
      const moduleId = Number(url.pathname.split('/').at(-2));
      data = [{ id: moduleId * 10, title: 'Teacher reading and practice', type: 'Page', html_url: `https://canvas.example.test/courses/12345/modules/items/${moduleId * 10}` }];
    } else if (url.pathname === '/api/v1/calendar_events') {
      const day = scenario === 'rescheduled' ? 22 : 15;
      data = [{ id: 9001, title: 'Unit 9 teaching week', context_code: 'course_12345', start_at: `2027-03-${day}T16:00:00Z`, end_at: `2027-03-${day + 4}T22:00:00Z`, html_url: 'https://canvas.example.test/calendar?event_id=9001', all_day: false }]
        .filter(event => event.start_at.slice(0, 10) <= url.searchParams.get('end_date') && event.end_at.slice(0, 10) >= url.searchParams.get('start_date'));
    } else return Response.json({}, { status: 404 });
    return Response.json(data);
  };
}

export function accountDemoFetch(scenario = 'original') {
  const single = demoFetch(scenario);
  return async (input, options) => {
    const url = new URL(input);
    if (url.pathname === '/api/v1/courses') return Response.json([
      { id: 12345, name: 'AP Chemistry · Fictional demo', course_code: 'CHEM', workflow_state: 'available', time_zone: 'America/Los_Angeles', term: { name: '2026–27' } },
      { id: 23456, name: 'English · Fictional demo', course_code: 'ENG', workflow_state: 'completed', time_zone: 'America/Los_Angeles', term: { name: '2025–26' } },
    ].filter(course => url.searchParams.getAll('state[]').includes(course.workflow_state)));
    const match = url.pathname.match(/^\/api\/v1\/courses\/(\d+)\/(assignments|pages|files|discussion_topics|quizzes)$/);
    if (match) {
      const [, courseId, type] = match;
      if (type === 'pages') return Response.json([{ page_id: 71, title: 'Study guide', url: 'study-guide', published: true }]);
      if (type === 'files') return Response.json([{ id: 81, display_name: 'Lesson notes.pdf', url: 'https://private-download.example/never-copy', locked_for_user: false }]);
      if (type === 'assignments') return Response.json([{ id: 91, name: 'Practice task', due_at: '2027-03-19T23:00:00Z', html_url: `https://canvas.example.test/courses/${courseId}/assignments/91`, published: true }]);
      if (type === 'quizzes') return Response.json([{ id: 92, title: 'Practice quiz', published: true }]);
      return Response.json([{ id: url.searchParams.get('only_announcements') === 'true' ? 93 : 94,
        title: url.searchParams.get('only_announcements') === 'true' ? 'Lesson update' : 'Course questions', published: true }]);
    }
    if (url.pathname === '/api/v1/courses/23456/modules') return Response.json([{ id: 109, name: 'Close reading', published: true }]);
    if (url.pathname === '/api/v1/courses/23456/modules/109/items') return Response.json([{ id: 1090, title: 'Reading guide', type: 'Page', html_url: 'https://canvas.example.test/courses/23456/pages/reading-guide' }]);
    if (url.pathname === '/api/v1/calendar_events' && url.searchParams.get('context_codes[]') === 'course_23456') return Response.json([]);
    return single(input, options);
  };
}
