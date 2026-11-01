import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

export interface StaticOptions {
  /** The built Activity (`apps/activity/dist`). */
  dir: string;
  /** Discord application id, put into index.html as a `crystalaid-client-id` meta tag. */
  clientId: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** Vite writes content-hashed names under /assets/, so those files never change. */
const IMMUTABLE_PREFIX = '/assets/';
const API_PREFIX = '/api';

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Uses a meta tag, not an inline script, so that a strict CSP inside Discord cannot block it. */
export function injectClientId(html: string, clientId: string): string {
  const tag = `<meta name="crystalaid-client-id" content="${escapeAttribute(clientId)}">`;
  const head = html.search(/<\/head>/i);
  return head >= 0 ? html.slice(0, head) + tag + html.slice(head) : tag + html;
}

/**
 * Resolves a request path to a file inside `root`. Null for anything that is not a plain path
 * below it: undecodable escapes, NUL, backslashes, `..` segments.
 */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded.split('/').includes('..')) return null;
  const file = resolve(root, '.' + (decoded.startsWith('/') ? decoded : `/${decoded}`));
  return file === root || file.startsWith(root + sep) ? file : null;
}

/**
 * Serves the built Activity from the same process as the API: files at `/`, anything without a
 * file extension that is not an API path falls back to index.html (client-side routes). Read-only
 * and exempt from the rate limit; the API routes are untouched and win over the wildcard.
 */
export async function registerStatic(app: FastifyInstance, options: StaticOptions): Promise<void> {
  const root = resolve(options.dir);
  const indexHtml = injectClientId(await readFile(resolve(root, 'index.html'), 'utf8'), options.clientId);

  const sendIndex = (reply: FastifyReply) =>
    reply
      .header('cache-control', 'no-cache')
      .header('x-content-type-options', 'nosniff')
      .type(TYPES['.html']!)
      .send(indexHtml);

  const handler = async (request: { url: string; originalUrl?: string; method: string }, reply: FastifyReply) => {
    const original = request.originalUrl ?? request.url;
    const originalPath = original.split('?')[0] ?? '/';
    // /api/<anything> that no route handled is an API miss, not a page.
    if (originalPath === API_PREFIX || originalPath.startsWith(`${API_PREFIX}/`)) return reply.callNotFound();

    const urlPath = request.url.split('?')[0] ?? '/';
    const file = resolveInside(root, urlPath);
    if (file === null) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Bad path' } });

    const ext = extname(urlPath).toLowerCase();
    if (ext === '' || ext === '.html') {
      // A directory-like or extension-less path is a client route. index.html itself is served
      // through the injecting copy, never from disk.
      return sendIndex(reply);
    }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return reply.callNotFound();
    const immutable = urlPath.startsWith(IMMUTABLE_PREFIX);
    return reply
      .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
      .header('x-content-type-options', 'nosniff')
      .type(TYPES[ext] ?? 'application/octet-stream')
      .header('content-length', info.size)
      .send(createReadStream(file));
  };

  const routeOptions = { config: { rateLimit: false as const } };
  app.get('/', routeOptions, handler);
  app.get('/*', routeOptions, handler);
}
