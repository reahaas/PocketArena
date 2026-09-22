import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Serves the built client next to the signaling socket, so the whole game is one process on one
 * port. That removes the build-time signaling URL, the separate proxy, and every mixed-content
 * and CORS failure mode that came with them.
 */
export function createStaticServer(rootDir: string | null): Server {
  const root = rootDir ? resolve(rootDir) : null;

  return createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (!root || !existsSync(root)) {
      response.writeHead(503, { 'content-type': 'text/plain' }).end('client build not found');
      return;
    }
    serveFile(root, request, response);
  });
}

function serveFile(root: string, request: IncomingMessage, response: ServerResponse): void {
  const requestPath = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');

  // normalize + prefix check keeps ../ traversal out of the served directory.
  const candidate = resolve(join(root, normalize(requestPath)));
  const isInsideRoot = candidate === root || candidate.startsWith(`${root}/`);

  const file =
    isInsideRoot && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : // Anything else is a client route such as /join/ABC123 and must get the SPA shell.
        join(root, 'index.html');

  if (!existsSync(file)) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }

  const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
  const immutable = file !== join(root, 'index.html') && requestPath.startsWith('/assets/');

  response.writeHead(200, {
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(response);
}
