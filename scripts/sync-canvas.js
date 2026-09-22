import { readConfig } from '../lib/config.js';
import { createStore } from '../lib/store.js';
import { createCanvasClient, accountDemoFetch, CanvasError } from '../lib/canvas.js';

try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const config = readConfig();
if (config.accountMissing.length) {
  console.error(`Missing private server settings: ${config.accountMissing.join(', ')}`);
  process.exitCode = 1;
} else {
  const start = process.argv[2] || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const end = process.argv[3] || new Date(Date.now() + 330 * 86400000).toISOString().slice(0, 10);
  const store = createStore(config.dbPath);
  const attemptedAt = new Date().toISOString();
  try {
    const client = createCanvasClient(config, config.mode === 'demo' ? accountDemoFetch() : fetch);
    const snapshot = await client.syncAccount(start, end, { previous: store.read(config.accountKey).snapshot,
      onProgress: ({ completed, total }) => { if (completed === total || completed === 0) console.log(`Canvas import: ${completed}/${total} courses processed.`); } });
    const saved = store.read(config.accountKey);
    store.write(config.accountKey, { ...saved, snapshot, lastAttempt: attemptedAt, lastError: null });
    console.log(JSON.stringify({ mode: config.mode, courses: snapshot.courses.length, warnings: snapshot.warnings, range: snapshot.range, completedAt: snapshot.completedAt }));
  } catch (error) {
    const message = error instanceof CanvasError ? error.message : 'Canvas import failed. The previous snapshot was kept.';
    const saved = store.read(config.accountKey);
    store.write(config.accountKey, { ...saved, lastAttempt: attemptedAt, lastError: message });
    console.error(message); process.exitCode = 1;
  } finally { store.close(); }
}
