/**
 * StaticFileServer — serves the built client bundle over plain HTTP on the
 * same port as the WebSocket transport.
 *
 * Pulled out of `index.ts` so the entry file doesn't carry five free
 * functions and a module-level `clientDistDir` constant. Same shape as
 * the other transport adapters: one class, one public method
 * (`handleRequest`), constructor takes the root dir.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';

const WS_PATH_PREFIX = '/ws';
/** Files whose contents change with each build and must not be cached long. */
const NO_CACHE_SUFFIXES = ['index.html', 'sw.js', 'manifest.webmanifest'] as const;

export class StaticFileServer {
  constructor(private readonly rootDir: string) {}

  /** Handle a single HTTP request from the server's request listener. */
  handleRequest(rawUrl: string, method: string, response: ServerResponse): void {
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const url = new URL(rawUrl, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith(WS_PATH_PREFIX)) {
      response.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Upgrade Required');
      return;
    }
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = this.safeResolve(requestedPath);
    if (filePath && this.existsAsFile(filePath)) {
      this.writeFile(filePath, method, response);
      return;
    }
    if (pathname.startsWith('/assets/') || pathname.includes('.')) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('资源不存在。');
      return;
    }
    const indexPath = this.safeResolve('/index.html');
    if (indexPath && existsSync(indexPath)) {
      this.writeFile(indexPath, method, response);
      return;
    }
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('前端文件不存在，请先在 client 目录运行 pnpm build。');
  }

  /**
   * Resolve a request path inside `rootDir`, refusing any path that
   * escapes it. Returns null for traversal attempts or the empty path.
   */
  private safeResolve(pathname: string): string | null {
    const filePath = resolve(this.rootDir, `.${pathname}`);
    const rel = relative(this.rootDir, filePath);
    if (rel.startsWith('..') || rel === '') return null;
    return filePath;
  }

  private existsAsFile(filePath: string): boolean {
    return existsSync(filePath) && statSync(filePath).isFile();
  }

  private writeFile(filePath: string, method: string, response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Cache-Control': shouldAvoidStaticCache(filePath)
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    });
    if (method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  }
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.json':
    case '.map': return 'application/json; charset=utf-8';
    case '.webmanifest': return 'application/manifest+json; charset=utf-8';
    case '.woff':
    case '.woff2': return 'font/woff2';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

function shouldAvoidStaticCache(filePath: string): boolean {
  return NO_CACHE_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
}