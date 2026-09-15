// Device-local prototype state. A shared application would replace this with an API.
export function createInitialState(courses, school) {
  return {
    version: 1,
    joined: school.defaultCourseIds.filter(id => courses.some(course => course.id === id)),
    questions: Object.fromEntries(courses.map(course => [course.id, structuredClone(course.questions || [])])),
    suggestions: [],
  };
}

export function loadState(storage, courses, school) {
  const fresh = createInitialState(courses, school);
  try {
    const saved = JSON.parse(storage.getItem(school.storageKey));
    if (!saved || saved.version !== 1) return fresh;
    if (Array.isArray(saved.joined)) fresh.joined = [...new Set(saved.joined.filter(id => courses.some(course => course.id === id)))];
    for (const course of courses) {
      const items = saved.questions?.[course.id];
      if (!Array.isArray(items)) continue;
      fresh.questions[course.id] = items.filter(q => q && typeof q.id === 'string' && typeof q.title === 'string' && typeof q.body === 'string' && typeof q.author === 'string' && Array.isArray(q.replies)).map(q => ({
        ...q, unitId: course.units.some(unit => unit.id === q.unitId) ? q.unitId : '',
        mine: q.mine === true, answered: q.answered === true,
        replies: q.replies.filter(reply => reply && typeof reply.author === 'string' && typeof reply.body === 'string'),
      }));
    }
    if (Array.isArray(saved.suggestions)) fresh.suggestions = saved.suggestions.filter(s => s && courses.some(c => c.id === s.courseId) && typeof s.title === 'string' && typeof s.url === 'string' && typeof s.source === 'string');
    return fresh;
  } catch { return fresh; }
}

export function saveState(storage, key, state) {
  try { storage.setItem(key, JSON.stringify(state)); return true; }
  catch { return false; }
}

export function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function parseRoute(hash, courses) {
  const [segment, courseId, section = 'resources'] = hash.replace(/^#/, '').split('/');
  return { page: segment || 'dashboard', course: courses.find(course => course.id === courseId), section };
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
