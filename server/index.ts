import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { SignalingServer, SIGNALING_PATH } from './signaling/SignalingServer';
import { log } from './signaling/log';

const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Serving the client from this process is the default whenever a build is present, so a
// deployment is one process on one port with nothing to configure.
const configured = process.env.STATIC_DIR;
const fallback = resolve(process.cwd(), 'dist');
const staticDir = configured ? resolve(configured) : existsSync(fallback) ? fallback : null;

const server = new SignalingServer({ port, allowedOrigins, staticDir });

void server.ready.then((boundPort) => {
  log.info('listening', { port: boundPort, path: SIGNALING_PATH, static: staticDir ?? 'none' });
  if (allowedOrigins.length === 0) {
    log.warn('origins.unrestricted', { note: 'ALLOWED_ORIGINS is empty (development only)' });
  }
});

async function shutdown(signal: string): Promise<void> {
  log.info('shutdown', { signal });
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
