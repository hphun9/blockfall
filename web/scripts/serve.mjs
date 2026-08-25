#!/usr/bin/env node
/**
 * A static file server for local play. No dependencies — the game has none, and
 * the dev server should not be the reason `npm install` becomes necessary.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';

    // Keep the server inside webRoot even if the path tries to climb out.
    const resolved = join(webRoot, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!resolved.startsWith(webRoot)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(resolved);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: `${path}/` }).end();
      return;
    }

    const body = await readFile(resolved);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(resolved)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, () => {
  console.log(`Block Fall — http://localhost:${port}`);
});
