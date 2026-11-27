import { readdirSync } from 'node:fs';
import type { Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import createServeStatic from 'serve-static';
import type { ServeStaticOptions } from 'serve-static';
import getOriginForm from '@helpers/origin-form';

type TNext = (error?: unknown) => void;

type TStaticRequest = IncomingMessage & { originalUrl?: string };

type TStaticMiddleware = (req: TStaticRequest, res: ServerResponse, next: TNext) => void;

type TFileOptions = ServeStaticOptions<ServerResponse>;

/**
 * Shell key and the configured extensions, both canonicalized like a request key.
 */
interface IShellGuardKeys {
  /** Lowercased request path of the shell. */
  shellPath: string;
  /** Lowercased extensions as send appends them, each listed once. */
  extensions: string[];
}

/**
 * How one file server keeps the HTML shell hidden.
 */
interface IShellGuard {
  keys: IShellGuardKeys;
  isWindows: boolean;
  /** File server that never appends the listed extensions, which lead this request to the shell. */
  getAliasServer: (names: string[]) => TStaticMiddleware;
}

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

const FILE_OPTION_KEYS = [
  'acceptRanges',
  'cacheControl',
  'dotfiles',
  'etag',
  'extensions',
  'fallthrough',
  'immutable',
  'index',
  'lastModified',
  'maxAge',
  'redirect',
  'setHeaders',
] as const;
const SERVER_OPTION_KEYS = [
  'root',
  'basename',
  'isSPA',
  'immutableFiles',
  'shellFile',
  'hasAccessIndexHtml',
] as const;
const DECLARED_KEYS: ReadonlySet<string> = new Set([...FILE_OPTION_KEYS, ...SERVER_OPTION_KEYS]);
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
 * Windows form of one path segment: an NTFS stream suffix such as `::$DATA` is cut off, then the
 * name loses its trailing dots and spaces. A segment left empty is kept, since Windows opens no
 * file through it.
 */
const trimWindowsSegment = (segment: string): string =>
  segment.replace(/:.*$/, '').replace(/[. ]+$/, '') || segment;

/**
 * Extension as send appends it after a dot, lowercased for case-insensitive disks and, on
 * Windows, trimmed like the segment it ends. `.html` still looks for `page..html`.
 */
const normalizeExtension = (name: unknown, isWindows: boolean): string => {
  const lowered = String(name).toLowerCase();

  return isWindows ? trimWindowsSegment(lowered) : lowered;
};

/**
 * Lowercased resolved form of a pathname used to match the shell. A backslash counts as a
 * separator, as it does for send on Windows, so no spelling of the shell slips past. On Windows
 * the segments are also trimmed as the file system trims them, so `/index.html.` matches.
 */
const getShellKey = (pathname: string, isWindows = process.platform === 'win32'): string => {
  const slashed = pathname.replace(/\\/g, '/');
  const resolved = isWindows ? slashed.split('/').map(trimWindowsSegment).join('/') : slashed;

  return path.posix.normalize(resolved).toLowerCase();
};

/**
 * Shell key and the configured extensions, canonicalized like a request key, so on Windows a
 * shell named `index.html.` or an extension written `html.` match what the disk opens.
 */
const getShellGuardKeys = (
  shellPath: string,
  extensions: unknown,
  isWindows = process.platform === 'win32',
): IShellGuardKeys => ({
  shellPath: getShellKey(shellPath, isWindows),
  extensions: Array.isArray(extensions)
    ? [...new Set(extensions.map((ext) => normalizeExtension(ext, isWindows)))]
    : [],
});

/**
 * Configured extensions send would append to this pathname to open the shell. send appends only
 * to a normalized path without an extension or a trailing separator, and the appended path is
 * keyed like a request, so on Windows `/page ` reaches `page .html` while `/page` only reaches
 * `page.html`.
 */
const getAliasExtensions = (
  keys: IShellGuardKeys,
  pathname: string,
  isWindows = process.platform === 'win32',
): string[] => {
  const normalized = path.posix.normalize(isWindows ? pathname.replace(/\\/g, '/') : pathname);

  if (!keys.extensions.length || normalized.endsWith('/') || path.posix.extname(normalized)) {
    return [];
  }

  return keys.extensions.filter(
    (name) => getShellKey(`${normalized}.${name}`, isWindows) === keys.shellPath,
  );
};

/**
 * serve-static options read once each by name, so inherited options and getters count and frozen
 * options are never written to. Unset ones stay out, so serve-static and send keep their own
 * defaults; own keys this module does not declare still reach serve-static.
 */
const readServeStaticOptions = (
  options: Partial<IServeStaticOptions>,
): Partial<IServeStaticOptions> => {
  const source = options as Record<string, unknown>;
  const read: Record<string, unknown> = {};

  for (const key of DECLARED_KEYS) {
    const value = source[key];

    if (value !== undefined) {
      read[key] = value;
    }
  }

  for (const key of Object.keys(source)) {
    if (DECLARED_KEYS.has(key)) {
      continue;
    }

    const value = source[key];

    if (value !== undefined) {
      read[key] = value;
    }
  }

  return read;
};

export { getShellKey, getShellGuardKeys, getAliasExtensions, readServeStaticOptions };

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
  const spaShell = spaShellFile ? path.resolve(root, spaShellFile).toLowerCase() : undefined;

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
    // The document names the current hashed files, so it revalidates even when listed.
    if (spaShell && path.resolve(filePath).toLowerCase() === spaShell) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (fingerprinted.has(path.relative(root, filePath).split(path.sep).join('/'))) {
      res.setHeader('Cache-Control', IMMUTABLE);
    }

    setHeaders?.(res, filePath, stat);
  };
};

/**
 * Guard for one file server: the shell's request path and, for a request an appended extension
 * leads to the shell, a server that resolves it without that extension. Keyed like requests,
 * since case-insensitive disks match any spelling.
 */
const createShellGuard = (
  root: string,
  shellFile: string,
  options: TFileOptions,
  isWindows = process.platform === 'win32',
): IShellGuard | undefined => {
  const relative = path.relative(root, path.resolve(root, shellFile));

  // A name such as `..shell.html` sits inside the root, so only a whole `..` segment leaves it.
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }

  const { extensions } = options;
  const keys = getShellGuardKeys(`/${relative.split(path.sep).join('/')}`, extensions, isWindows);
  const servers = new Map<string, TStaticMiddleware>();

  /**
   * One alias server per set of skipped extensions, made on first use.
   */
  const getAliasServer = (names: string[]): TStaticMiddleware => {
    const id = JSON.stringify(names);
    const known = servers.get(id);

    if (known) {
      return known;
    }

    const otherExtensions = (extensions as unknown[]).filter(
      (other) => !names.includes(normalizeExtension(other, isWindows)),
    ) as string[];
    // send still serves a literal file, redirects a directory and tries the other extensions.
    // A miss falls through to the router like the shell itself, also with `fallthrough: false`.
    const server = createServeStatic(root, {
      ...options,
      extensions: otherExtensions.length ? otherExtensions : false,
      fallthrough: true,
    }) as TStaticMiddleware;

    servers.set(id, server);

    return server;
  };

  return { keys, isWindows, getAliasServer };
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
const serveStatic = (staticOptions: IServeStaticOptions): TStaticMiddleware => {
  const {
    root,
    basename,
    isSPA = false,
    immutableFiles,
    shellFile = 'index.html',
    hasAccessIndexHtml,
    ...options
  } = readServeStaticOptions(staticOptions) as IServeStaticOptions;
  const mount = normalizeBasename(basename);
  // serve-static resolves its root once, so the shell is matched against that same directory.
  const resolvedRoot = path.resolve(root);
  // send reads the extension list on every request, so every server and guard shares one copy
  // taken here and a caller changing its array later cannot split them.
  const extensions = Array.isArray(options.extensions)
    ? [...(options.extensions as unknown[])]
    : options.extensions;
  const fileOptions: TFileOptions = { ...options };
  const setHeaders = createCachePolicy(
    resolvedRoot,
    immutableFiles,
    options,
    isSPA ? shellFile : undefined,
  );

  if (extensions !== undefined) {
    fileOptions.extensions = extensions as TFileOptions['extensions'];
  }

  if (!isSPA) {
    fileOptions.index = false;
  }

  if (setHeaders) {
    fileOptions.setHeaders = setHeaders;
  }

  const wellKnownOptions: TFileOptions = {
    ...fileOptions,
    dotfiles: 'allow',
    extensions: fileOptions.extensions ?? ['json'],
  };
  const plain = createServeStatic(resolvedRoot, fileOptions) as TStaticMiddleware;
  const serve = isSPA ? plain : createSsrServe(resolvedRoot, plain, fileOptions);
  const serveWellKnown =
    options.dotfiles === undefined
      ? (createServeStatic(resolvedRoot, wellKnownOptions) as TStaticMiddleware)
      : undefined;
  // Each file server resolves extensions its own way, so each gets its own guard.
  const shellGuard = isSPA ? undefined : createShellGuard(resolvedRoot, shellFile, fileOptions);
  const wellKnownShellGuard = isSPA
    ? undefined
    : createShellGuard(resolvedRoot, shellFile, wellKnownOptions);

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

    const guard = isWellKnown ? wellKnownShellGuard : shellGuard;
    const isShell =
      guard !== undefined &&
      pathname !== undefined &&
      getShellKey(pathname, guard.isWindows) === guard.keys.shellPath;
    const aliasNames =
      guard === undefined || pathname === undefined || isShell
        ? []
        : getAliasExtensions(guard.keys, pathname, guard.isWindows);
    let fileServer: TStaticMiddleware | undefined = isWellKnown ? serveWellKnown : serve;

    // The shell is matched by the file it resolves to, so no URL spelling reaches it.
    if ((isShell || aliasNames.length) && !hasAccessIndexHtml?.()) {
      if (isShell) {
        next();

        return;
      }

      fileServer = guard?.getAliasServer(aliasNames);
    }

    // serve-static builds directory redirects from originalUrl, so a client host never leaks in,
    // also when Express or Connect already copied an absolute-form target there.
    req.originalUrl = originalUrl === undefined ? target : (getOriginForm(originalUrl) ?? target);
    req.url = mountedUrl;

    /**
     * Hand the untouched request to the next middleware.
     */
    const restore: TNext = (error) => {
      req.url = url;
      req.originalUrl = originalUrl;
      next(error);
    };

    (fileServer ?? serve)(req, res, restore);
  };
};

export type { IServeStaticOptions, TStaticMiddleware };

export default serveStatic;
