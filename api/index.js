import { createAppHandler } from '../server.js';
import { readConfig } from '../lib/config.js';

// Vercel supplies production secrets; no local environment files are loaded.
export default createAppHandler({ config: readConfig() });
