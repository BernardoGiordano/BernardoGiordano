import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';

const ROOT = resolve(import.meta.dirname, '../..');
const PORT = Number(process.env.PORT ?? 8000);
const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:8001';

const MOUNTS = [
  ['/lib/', join(ROOT, 'node_modules/@srljs/core/lib')],
  ['/components/', join(ROOT, 'node_modules/@srljs/core/components')],
  ['/', join(ROOT, 'web')],
];

const PROXIED = ['/api/', '/auth/', '/media/'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();

function resolveFile(pathname) {
  for (const [prefix, dir] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue;
    const rest = pathname.slice(prefix.length);
    const target = normalize(join(dir, rest));
    if (!target.startsWith(dir)) return null;
    if (existsSync(target) && statSync(target).isFile()) return target;
  }
  return null;
}

function proxy(req, res) {
  const upstream = new URL(API);
  const forwarded = httpRequest(
    {
      hostname: upstream.hostname,
      port: upstream.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: upstream.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  forwarded.on('error', () => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'backend_unavailable', detail: `no listener on ${API}` }));
  });
  req.pipe(forwarded);
}

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);

  if (pathname === '/__reload.js') {
    res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
    res.end("new EventSource('/__reload').onmessage = () => location.reload();\n");
    return;
  }

  if (pathname === '/__reload') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('retry: 500\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (PROXIED.some((prefix) => pathname.startsWith(prefix))) return proxy(req, res);

  const file = resolveFile(pathname);
  if (file !== null) {
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
    return;
  }

  const index = join(ROOT, 'web/index.html');
  if (!existsSync(index)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('web/index.html is missing');
    return;
  }
  const html = await readFile(index, 'utf8');
  res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
  res.end(html.replace('</body>', '<script src="/__reload.js"></script></body>'));
});

for (const dir of [join(ROOT, 'web'), join(ROOT, 'node_modules/@srljs/core')]) {
  if (!existsSync(dir)) continue;
  watch(dir, { recursive: true }, () => {
    for (const client of clients) client.write('data: reload\n\n');
  });
}

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  process.stdout.write(`web/          -> ${url}\nlib+components-> ${url}/lib/, ${url}/components/\napi proxy     -> ${API}\n`);
  if (process.argv.includes('--open')) {
    const open = process.platform === 'darwin' ? 'open' : 'xdg-open';
    import('node:child_process').then(({ spawn }) => spawn(open, [url], { stdio: 'ignore' }).unref());
  }
});
