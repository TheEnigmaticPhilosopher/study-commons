// A read-only projection of saved resources. It never starts a Canvas request.
export function saltyCatalog(config, saved, courseIds, running = false) {
  const snapshot = saved.snapshot;
  const source = { provider: 'canvas', instance: config.baseUrl };
  const reference = (courseId, entity, id) => ({ ...source, courseId, entity, id,
    key: JSON.stringify(['canvas', config.baseUrl, courseId, entity, id]) });
  const courses = (snapshot?.courses || []).filter(record => courseIds.includes(record.course.id)).map(record => {
    const courseId = record.course.id;
    const hubUrl = `${config.origin}/#canvas-course/${courseId}`;
    const collections = Object.fromEntries(Object.entries(record.collections).map(([key, value]) => [key, { ...value }]));
    const resources = {};
    for (const category of ['assignments', 'pages', 'files', 'announcements', 'discussions', 'quizzes', 'events']) {
      resources[category] = record[category].map(item => ({ ...item, sourceRef: reference(courseId, category, item.id), hubUrl: `${hubUrl}/${category}` }));
    }
    const moduleIds = new Set(record.modules.map(module => module.id));
    const eventIds = new Set(record.events.map(event => event.id));
    return { ...record.course, sourceRef: reference(courseId, 'course', courseId), hubUrl: `${hubUrl}/modules`,
      syncedAt: record.syncedAt, attemptedAt: record.attemptedAt, range: record.range, collections, warnings: record.warnings,
      modules: record.modules.map(module => ({ ...module, sourceRef: reference(courseId, 'modules', module.id), hubUrl: `${hubUrl}/modules`,
        items: module.items.map(item => ({ ...item, sourceRef: reference(courseId, 'module-items', item.id), hubUrl: `${hubUrl}/modules` })) })),
      ...resources,
      teachingLinks: saved.mappings.filter(mapping => mapping.courseId === courseId && moduleIds.has(mapping.moduleId) && eventIds.has(mapping.eventId))
        .map(({ moduleId, eventId }) => ({ moduleId, eventId })) };
  });
  const unavailableCourseIds = courseIds.filter(id => !courses.some(course => course.id === id));
  const warnings = courses.reduce((count, course) => count + course.warnings.length, 0);
  const status = running ? 'running' : saved.lastError ? 'failed' : !snapshot ? 'not_synced' : warnings || unavailableCourseIds.length ? 'partial' : 'complete';
  return { schemaVersion: 1, mode: config.mode, source, hubOrigin: config.origin, scope: courseIds, unavailableCourseIds,
    sync: { status, lastAttempt: saved.lastAttempt, completedAt: snapshot?.completedAt || null, error: saved.lastError || null, warnings },
    courses };
}
