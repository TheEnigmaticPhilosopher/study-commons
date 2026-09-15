import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Only public assets are served. Source, configuration and secrets stay private.
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/data.js', ['data.js', 'text/javascript; charset=utf-8']],
  ['/state.js', ['state.js', 'text/javascript; charset=utf-8']],
]);

export function createAppServer() {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'");
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400).end('Bad request'); return; }
    if (pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', mode: 'browser-local-prototype' }));
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
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = createAppServer();
  server.listen(port, '0.0.0.0', () => console.log(`Study Commons running at http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
