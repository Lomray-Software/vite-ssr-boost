import { readdirSync } from 'node:fs';
import type { Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import createServeStatic from 'serve-static';
import type { ServeStaticOptions } from 'serve-static';

type TNext = (error?: unknown) => void;

type TStaticRequest = IncomingMessage & { originalUrl?: string };

type TStaticMiddleware = (req: TStaticRequest, res: ServerResponse, next: TNext) => void;

type TFileOptions = ServeStaticOptions<ServerResponse>;

/**
 * Options of serve-static, declared here so the package declarations need no serve-static types.
 */
interface IServeStaticOptions {
  acceptRanges?: boolean;
  cacheControl?: boolean;
  dotfiles?: string;
  etag?: boolean;
  extensions?: string[] | false;
  fallthrough?: boolean;
  immutable?: boolean;
  index?: boolean | string | string[];
  lastModified?: boolean;
  maxAge?: number | string;
  redirect?: boolean;
  setHeaders?: (res: ServerResponse, path: string, stat: Stats) => void;
  /** Directory with the built client files. */
  root: string;
  /** Public URL prefix the directory is mounted at; matched case-insensitively like Express. */
  basename?: string;
  /** SPA builds serve every file, including the document. */
  isSPA?: boolean;
  /** Content-hashed files relative to root; only these get an immutable one-year policy. */
  immutableFiles?: Iterable<string>;
  /** Built HTML shell, absolute or relative to root; SSR builds hide it. Defaults to `index.html`. */
  shellFile?: string;
  /** SSR builds hide the raw HTML shell unless this returns true. */
  hasAccessIndexHtml?: () => boolean;
}

const WELL_KNOWN = '/.well-known/';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Decoded pathname of a request URL, undefined for malformed encoding.
 * Query and fragment both end the path, as parseurl in serve-static reads it.
 */
const getPathname = (url: string): string | undefined => {
  try {
    return decodeURIComponent(url.split(/[?#]/, 1)[0]);
  } catch {
    return undefined;
  }
};

/**
 * Lowercased resolved form of a pathname used to match the shell. A backslash counts as a
 * separator, as it does for send on Windows, so no spelling of the shell slips past.
 */
const getShellKey = (pathname: string): string =>
  path.posix.normalize(pathname.replace(/\\/g, '/')).toLowerCase();

export { getShellKey };

/**
 * Origin-form target of a request: an absolute-form target (`GET http://host/path`) keeps only
 * its path and query, so the shell check and serve-static read the same path. Undefined when
 * the target is neither form, which leaves the request to the next handler.
 */
const getOriginForm = (url: string): string | undefined => {
  if (url.startsWith('/')) {
    return url;
  }

  try {
    const { protocol, pathname, search } = new URL(url);

    return protocol === 'http:' || protocol === 'https:' ? `${pathname}${search}` : undefined;
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

  if (rest === '' || rest.startsWith('?') || rest.startsWith('#')) {
    return `/${rest}`;
  }

  return rest.startsWith('/') ? rest : undefined;
};

/**
 * Give the listed content-hashed files a long-lived policy, the SPA document `no-cache` like
 * its route fallback, and leave every other file revalidating.
 */
const createCachePolicy = (
  root: string,
  immutableFiles: Iterable<string> | undefined,
  { cacheControl, immutable, maxAge, setHeaders }: TFileOptions,
  spaShellFile?: string,
): TFileOptions['setHeaders'] => {
  const fingerprinted = new Set(
    [...(immutableFiles ?? [])].map((file) => path.posix.normalize(file).replace(/^\/+/, '')),
  );
  const spaShell = spaShellFile ? path.resolve(root, spaShellFile) : undefined;

  // An explicit maxAge or immutable option means the caller owns the policy for every file.
  if (
    (!fingerprinted.size && !spaShell) ||
    cacheControl === false ||
    maxAge !== undefined ||
    immutable !== undefined
  ) {
    return setHeaders;
  }

  /**
   * send keeps a Cache-Control header that is already set, so this runs before its default.
   */
  return (res, filePath, stat) => {
    if (fingerprinted.has(path.relative(root, filePath).split(path.sep).join('/'))) {
      res.setHeader('Cache-Control', IMMUTABLE);
    } else if (spaShell && path.resolve(filePath) === spaShell) {
      res.setHeader('Cache-Control', 'no-cache');
    }

    setHeaders?.(res, filePath, stat);
  };
};

/**
 * Request paths that resolve to the shell: its own path and, when send may append its
 * extension, the extensionless form. Lowercased, since case-insensitive disks match any spelling.
 */
const getShellPaths = (
  root: string,
  shellFile: string,
  extensions: TFileOptions['extensions'],
): Set<string> => {
  const relative = path.relative(root, path.resolve(root, shellFile));

  // A name such as `..shell.html` sits inside the root, so only a whole `..` segment leaves it.
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return new Set();
  }

  const shellPath = `/${relative.split(path.sep).join('/')}`.toLowerCase();
  const extension = path.posix.extname(shellPath);
  const paths = new Set([shellPath]);

  if (
    extension &&
    Array.isArray(extensions) &&
    extensions.some((name) => `.${String(name).replace(/^\./, '').toLowerCase()}` === extension)
  ) {
    paths.add(shellPath.slice(0, -extension.length));
  }

  return paths;
};

/**
 * Send HTML routes straight on while retaining static handling for built file prefixes.
 */
const createSsrServe = (
  root: string,
  serve: TStaticMiddleware,
  options: TFileOptions,
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
  immutableFiles,
  shellFile = 'index.html',
  hasAccessIndexHtml,
  ...options
}: IServeStaticOptions): TStaticMiddleware => {
  const mount = normalizeBasename(basename);
  const wellKnownExtensions = options.extensions ?? ['json'];
  // Each file server resolves extensions its own way, so each gets the aliases it would serve.
  const shellPaths = isSPA ? new Set<string>() : getShellPaths(root, shellFile, options.extensions);
  const wellKnownShellPaths = isSPA
    ? new Set<string>()
    : getShellPaths(root, shellFile, wellKnownExtensions);
  const fileOptions: TFileOptions = {
    ...options,
    index: isSPA ? options.index : false,
    setHeaders: createCachePolicy(root, immutableFiles, options, isSPA ? shellFile : undefined),
  };
  const plain = createServeStatic(root, fileOptions) as TStaticMiddleware;
  const serve = isSPA ? plain : createSsrServe(root, plain, fileOptions);
  const serveWellKnown =
    options.dotfiles === undefined
      ? (createServeStatic(root, {
          ...fileOptions,
          dotfiles: 'allow',
          extensions: wellKnownExtensions,
        }) as TStaticMiddleware)
      : undefined;

  /**
   * Strip the mount, pick the file server and restore the request before falling through.
   */
  return (req, res, next) => {
    const url = req.url ?? '/';
    const target = getOriginForm(url);
    const mountedUrl = target === undefined ? undefined : getMountedUrl(target, mount);

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

    // The shell is matched by the file it resolves to, so no URL spelling reaches it.
    if (
      pathname !== undefined &&
      (isWellKnown ? wellKnownShellPaths : shellPaths).has(getShellKey(pathname)) &&
      !hasAccessIndexHtml?.()
    ) {
      next();

      return;
    }

    // serve-static builds directory redirects from originalUrl, so a client host never leaks in.
    req.originalUrl = originalUrl ?? target;
    req.url = mountedUrl;

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
