import { readdirSync } from 'node:fs';
import type { RequestHandler } from 'express';
import express from 'express';
import type { ServeStaticOptions } from 'serve-static';

/**
 * Send HTML routes directly to SSR while retaining static handling for built file prefixes.
 */
const staticFiles = (root: string, options: ServeStaticOptions): RequestHandler => {
  const serve = express.static(root, options);

  if (options.fallthrough === false || options.extensions) {
    return serve;
  }

  let prefixes: Set<string>;

  try {
    prefixes = new Set(readdirSync(root).map((name) => name.toLowerCase()));
  } catch {
    return serve;
  }

  /**
   * Keep URL validation, file metadata, ranges and redirects in serve-static.
   */
  return (request, response, next) => {
    let pathname: string;

    try {
      pathname = decodeURIComponent(request.url.split('?', 1)[0]);
    } catch {
      serve(request, response, next);

      return;
    }

    const separator = pathname.indexOf('/', 1);
    const prefix = pathname.slice(1, separator < 0 ? undefined : separator).toLowerCase();

    if (
      prefixes.has(prefix) ||
      pathname.includes('/.') ||
      pathname.includes('\\') ||
      pathname.includes('\0') ||
      pathname.startsWith('//')
    ) {
      serve(request, response, next);

      return;
    }

    next();
  };
};

export default staticFiles;
