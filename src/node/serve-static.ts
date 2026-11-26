import { readdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import createServeStatic from 'serve-static';
import type { ServeStaticOptions } from 'serve-static';

type TNext = (error?: unknown) => void;

type TStaticRequest = IncomingMessage & { originalUrl?: string };

type TStaticMiddleware = (req: TStaticRequest, res: ServerResponse, next: TNext) => void;

interface IServeStaticOptions extends ServeStaticOptions<ServerResponse> {
  /** Directory with the built client files. */
  root: string;
  /** Public URL prefix the directory is mounted at; matched case-insensitively like Express. */
  basename?: string;
  /** SPA builds serve every file, including the document. */
  isSPA?: boolean;
  /** Directory under root holding fingerprinted bundles; they get an immutable one-year policy. */
  assetsDir?: string;
  /** SSR builds hide the raw `/index.html` shell unless this returns true. */
  hasAccessIndexHtml?: () => boolean;
}

const WELL_KNOWN = '/.well-known/';
const HIDDEN_INDEX = '/index-not-found.html';
const IMMUTABLE = 'public, max-age=31536000, immutable';

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
 * Lowercased mount prefix without trailing slashes; the root mount is empty.
 */
const normalizeBasename = (basename = '/'): string => basename.replace(/\/+$/, '').toLowerCase();

/**
 * URL relative to the mount, undefined when the request is outside it.
 */
const getMountedUrl = (url: string, mount: string): string | undefined => {
  if (!mount) {
    return url;
  }

  if (!url.toLowerCase().startsWith(mount)) {
    return undefined;
  }

  const rest = url.slice(mount.length);

  if (rest === '' || rest.startsWith('?')) {
    return `/${rest}`;
  }

  return rest.startsWith('/') ? rest : undefined;
};

/**
 * Give fingerprinted bundles a long-lived policy and leave every other file revalidating.
 */
const createCachePolicy = (
  root: string,
  assetsDir: string,
  { cacheControl, immutable, maxAge, setHeaders }: ServeStaticOptions<ServerResponse>,
): ServeStaticOptions<ServerResponse>['setHeaders'] => {
  // An explicit maxAge or immutable option means the caller owns the policy for every file.
  if (cacheControl === false || maxAge !== undefined || immutable !== undefined) {
    return setHeaders;
  }

  const fingerprinted = new RegExp(
    String.raw`^${assetsDir.replace(/^\/+|\/+$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+-[\w-]{8,}\.[^/]+$`,
  );

  /**
   * send keeps a Cache-Control header that is already set, so this runs before its default.
   */
  return (res, filePath, stat) => {
    if (fingerprinted.test(path.relative(root, filePath).split(path.sep).join('/'))) {
      res.setHeader('Cache-Control', IMMUTABLE);
    }

    setHeaders?.(res, filePath, stat);
  };
};

/**
 * Send HTML routes straight on while retaining static handling for built file prefixes.
 */
const createSsrServe = (
  root: string,
  serve: TStaticMiddleware,
  options: ServeStaticOptions<ServerResponse>,
): TStaticMiddleware => {
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
  return (req, res, next) => {
    const pathname = getPathname(req.url ?? '/');

    if (pathname === undefined) {
      serve(req, res, next);

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
      serve(req, res, next);

      return;
    }

    next();
  };
};

/**
 * Serve the public directory as Connect middleware.
 * serve-static skips dotfiles unless told otherwise, but `/.well-known/` (app links,
 * security.txt, ACME challenges) must reach the client: without an explicit `dotfiles`
 * option that prefix alone is served, other dot paths stay hidden.
 * Well-known files are requested without an extension (apple-app-site-association) while
 * tooling keeps them as `.json` on disk, so that prefix also resolves `name` to `name.json`.
 */
const serveStatic = ({
  root,
  basename,
  isSPA = false,
  assetsDir = 'assets',
  hasAccessIndexHtml,
  ...options
}: IServeStaticOptions): TStaticMiddleware => {
  const mount = normalizeBasename(basename);
  const fileOptions: ServeStaticOptions<ServerResponse> = {
    ...options,
    index: isSPA ? options.index : false,
    setHeaders: createCachePolicy(root, assetsDir, options),
  };
  const plain = createServeStatic(root, fileOptions) as TStaticMiddleware;
  const serve = isSPA ? plain : createSsrServe(root, plain, fileOptions);
  const serveWellKnown =
    options.dotfiles === undefined
      ? (createServeStatic(root, {
          ...fileOptions,
          dotfiles: 'allow',
          extensions: options.extensions ?? ['json'],
        }) as TStaticMiddleware)
      : undefined;

  /**
   * Strip the mount, pick the file server and restore the request before falling through.
   */
  return (req, res, next) => {
    const url = req.url ?? '/';
    const mountedUrl = getMountedUrl(url, mount);

    if (mountedUrl === undefined) {
      next();

      return;
    }

    const { originalUrl } = req;
    const pathname = getPathname(mountedUrl);
    // send resolves `..` inside the root, so the prefix is checked on the resolved path.
    const isWellKnown =
      serveWellKnown !== undefined &&
      pathname !== undefined &&
      !pathname.includes('\\') &&
      path.posix.normalize(pathname).startsWith(WELL_KNOWN);
    const isHiddenIndex =
      !isSPA &&
      pathname !== undefined &&
      path.posix.normalize(pathname).toLowerCase() === '/index.html';

    req.originalUrl = originalUrl ?? url;
    req.url = isHiddenIndex && !hasAccessIndexHtml?.() ? HIDDEN_INDEX : mountedUrl;

    /**
     * Hand the untouched request to the next middleware.
     */
    const restore: TNext = (error) => {
      req.url = url;
      req.originalUrl = originalUrl;
      next(error);
    };

    (isWellKnown ? serveWellKnown : serve)(req, res, restore);
  };
};

export type { IServeStaticOptions, TStaticMiddleware };

export default serveStatic;
