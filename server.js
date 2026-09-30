import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readConfig } from './lib/config.js';
import { createStore } from './lib/store.js';
import { createApi } from './lib/api.js';
import { createCloudApi } from './lib/cloud-api.js';
import { createBlobStore } from './lib/blob-store.js';

// Only public assets are served. Source, configuration and secrets stay private.
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/data.js', ['data.js', 'text/javascript; charset=utf-8']],
  ['/state.js', ['state.js', 'text/javascript; charset=utf-8']],
  ['/canvas.js', ['canvas.js', 'text/javascript; charset=utf-8']],
  ['/canvas-account.js', ['canvas-account.js', 'text/javascript; charset=utf-8']],
]);

export function createAppHandler({ config = readConfig({}), store, fetcher } = {}) {
  store ||= config.storageDriver === 'blob' ? createBlobStore({ token: config.blobToken, storeId: config.blobStoreId }) : createStore();
  const api = (config.storageDriver === 'blob' ? createCloudApi : createApi)(config, store, { fetcher });
  const handler = async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400).end('Bad request'); return; }
    if (await api(request, response, pathname)) return;
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    if (pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
      return;
    }
    const asset = assets.get(pathname);
    if (!asset) { response.writeHead(404).end('Not found'); return; }
    try {
      const bytes = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(500).end('Unable to load this page');
    }
  };
  handler.close = () => { api.close(); store.close(); };
  return handler;
}

export function createAppServer(options) {
  const handler = createAppHandler(options);
  const server = createServer(handler);
  server.on('close', () => handler.close());
  server.requestTimeout = 150000;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.env.VERCEL) { try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const config = readConfig();
  const { port } = config;
  const server = createAppServer({ config, store: config.storageDriver === 'blob' ? undefined : createStore(config.dbPath) });
  server.listen(port, '0.0.0.0', () => console.log(`Study Commons running at http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
