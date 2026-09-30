import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../lib/config.js';

// Only explicitly allowed values travel through stdin. The .env file is never uploaded.
if (!existsSync('.vercel/project.json')) throw new Error('Link the intended Vercel project first.');
const privateEnv = parseEnv(readFileSync('.env', 'utf8'));
const config = readConfig({ ...privateEnv, STORAGE_DRIVER: 'sqlite' });
if (config.mode !== 'live' || config.accountMissing.length || !config.password) {
  throw new Error('Configure the live Canvas account and personal pilot password privately first.');
}
const settings = [
  ['CANVAS_MODE', 'live', false],
  ['CANVAS_BASE_URL', config.baseUrl, false],
  ['CANVAS_ACCESS_TOKEN', config.token, true],
  ['HUB_ADMIN_PASSWORD', config.password, true],
  ['STORAGE_DRIVER', 'blob', false],
  ['ENABLE_EXPERIMENTAL_COREPACK', '1', false],
];
for (const [key, value, secret] of settings) {
  const result = spawnSync(process.execPath, ['node_modules/vercel/dist/index.js', 'env', 'add', key,
    'production', '--yes', '--force', secret ? '--sensitive' : '--no-sensitive'], {
    input: value, encoding: 'utf8', windowsHide: true, timeout: 120000,
  });
  // Never echo CLI output: provider error messages can contain the submitted value.
  if (result.error || result.status !== 0) throw new Error(`Vercel could not save ${key}; check project access and sign-in.`);
  console.log(`Saved production ${secret ? 'secret' : 'setting'}: ${key}`);
}
