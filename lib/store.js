import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS canvas_state (source TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;');
  return {
    read(source) {
      const row = db.prepare('SELECT value FROM canvas_state WHERE source = ?').get(source);
      return row ? JSON.parse(row.value) : { snapshot: null, mappings: [], lastAttempt: null, lastError: null };
    },
    write(source, value) {
      // One atomic replacement: a partial/failed fetch never overwrites a complete snapshot.
      db.prepare('INSERT INTO canvas_state(source,value) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET value=excluded.value')
        .run(source, JSON.stringify(value));
    },
    close() { db.close(); },
  };
}
