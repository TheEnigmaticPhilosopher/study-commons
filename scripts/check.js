import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['server.js', ...['api', 'lib', 'public', 'test', 'scripts'].flatMap(dir => readdirSync(dir).filter(file => file.endsWith('.js')).map(file => `${dir}/${file}`))];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
