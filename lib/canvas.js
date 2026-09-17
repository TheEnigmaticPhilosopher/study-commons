export class CanvasError extends Error {}

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
      throw new CanvasError(messages[response.status] || 'Canvas returned an unexpected response. Try again later.');
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
    return { payload, link: response.headers.get('link') || '' };
  }
  async function list(path, params, signal) {
    const first = new URL(path, base);
    first.search = new URLSearchParams({ ...params, per_page: '100' }).toString();
    let next = first;
    const seen = new Set(); const values = [];
    while (next) {
      if (next.origin !== base || next.pathname !== first.pathname || next.username || next.password || next.searchParams.has('access_token')) {
        throw new CanvasError('Canvas returned an unsafe pagination link. Sync was stopped.');
      }
      // Keep the explicit course and date filters even if a pagination link omits them.
      for (const [key, value] of Object.entries(params)) next.searchParams.set(key, value);
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
  return {
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
  };
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
