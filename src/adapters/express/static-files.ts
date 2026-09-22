import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from 'express';
import express from 'express';
import type { ServeStaticOptions } from 'serve-static';

const WELL_KNOWN = '/.well-known/';

/**
 * Decoded pathname of a request URL, undefined for malformed encoding
 */
const getPathname = (url: string): string | undefined => {
  try {
    return decodeURIComponent(url.split('?', 1)[0]);
  } catch {
    return undefined;
  }
};

/**
 * Send HTML routes directly to SSR while retaining static handling for built file prefixes.
 */
const ssrStaticFiles = (root: string, options: ServeStaticOptions): RequestHandler => {
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
    const pathname = getPathname(request.url);

    if (pathname === undefined) {
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

/**
 * Serve the public directory.
 * serve-static skips dotfiles unless told otherwise, but `/.well-known/` (app links,
 * security.txt, ACME challenges) must reach the client: without an explicit `dotfiles`
 * option that prefix alone is served, other dot paths stay hidden.
 */
const staticFiles = (root: string, options: ServeStaticOptions, isSPA = false): RequestHandler => {
  const serve = isSPA ? express.static(root, options) : ssrStaticFiles(root, options);

  if (options.dotfiles !== undefined) {
    return serve;
  }

  const serveWellKnown = express.static(root, { ...options, dotfiles: 'allow' });

  return (request, response, next) => {
    const pathname = getPathname(request.url);
    // send resolves `..` inside the root, so the prefix is checked on the resolved path.
    const isWellKnown =
      pathname !== undefined &&
      !pathname.includes('\\') &&
      path.posix.normalize(pathname).startsWith(WELL_KNOWN);

    (isWellKnown ? serveWellKnown : serve)(request, response, next);
  };
};

export default staticFiles;
