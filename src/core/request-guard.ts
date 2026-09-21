import type { RouterState, StaticHandler } from 'react-router';
import { matchRoutes } from 'react-router';
import headResponse from '@core/head-response';
import requestTargets from '@core/request-target';

export type TRequestGuardReason =
  'method' | 'target-too-large' | 'malformed-target' | 'blocked-extension' | 'route' | 'decide';

export interface IRequestGuardDecisionContext {
  /** Original Fetch request. */
  request: Request;
  /** Parsed document URL. */
  url: URL;
  /** Structural matches, without executing loaders. */
  matches: RouterState['matches'];
}

export interface IRequestGuardOptions {
  /** Allowed document methods. Default: GET, HEAD, POST. */
  methods?: string[];
  /** Maximum UTF-8 bytes in pathname plus search. Default: 8192. */
  maxTargetBytes?: number;
  /** Maximum UTF-8 bytes in the pathname. Default: 2048. */
  maxPathBytes?: number;
  /** Maximum UTF-8 bytes in the query, excluding ?. Default: 6144. */
  maxQueryBytes?: number;
  /** Maximum nonempty path segments. Default: 32. */
  maxSegments?: number;
  /** Maximum UTF-8 bytes per segment. Default: 1024. */
  maxSegmentBytes?: number;
  /** Reject encoded delimiters, including a second decoding pass. Default: allow. */
  encodedDelimiters?: 'allow' | 'reject';
  /** Override script-extension probes; strings are literal extensions without a dot. */
  blockedExtensions?: RegExp | string[] | false;
  /** Block dotfile segments, except /.well-known/*. Default: true. */
  blockDotfiles?: boolean;
  /** Override a matched request after built-in checks. */
  decide?: (
    context: IRequestGuardDecisionContext,
  ) =>
    | 'allow'
    | 'notFound'
    | Response
    | undefined
    | Promise<'allow' | 'notFound' | Response | undefined>;
  /** Observe rejections without affecting their response. */
  onReject?: (event: { request: Request; reason: TRequestGuardReason; status: number }) => void;
}

export interface IRequestGuardResult {
  /** Matches are shared with policy and SPA preparation. */
  matches: RouterState['matches'];
  /** A terminal response skips request initialization. */
  response?: Response;
  /** Missing routes continue through the configured 404 mode. */
  notFound?: boolean;
  /** Low-cardinality rejection classification. */
  reason?: TRequestGuardReason;
}

const SCRIPT_EXTENSION =
  /\.(?:php\d*|phtml|phar|asp|aspx|jsp|jspx|cgi|cfm|cfml|action|do|faces|shtml)\/?$/i;
const ENCODED_DELIMITER = /%(?:2f|5c|23|3f)/i;
const encoder = new TextEncoder();

/** Validate document targets before application hooks, route policy or loaders run. */
class RequestGuard {
  /** Snapshot methods and bounds at handler creation. */
  protected readonly options: Required<Omit<IRequestGuardOptions, 'decide' | 'onReject'>> &
    Pick<IRequestGuardOptions, 'decide' | 'onReject'>;

  /** Clone expressions so application lastIndex is never mutated. */
  protected readonly extensions: RegExp | Set<string> | false;

  /** Retain the mounted data routes and basename. */
  public constructor(
    /** Mounted data routes, without running loaders. */
    protected readonly routes: StaticHandler['dataRoutes'] = [],
    options: IRequestGuardOptions = {},
    /** Match the router mount point. */
    protected readonly basename = '/',
  ) {
    this.options = {
      ...options,
      methods: options.methods ?? ['GET', 'HEAD', 'POST'],
      maxTargetBytes: options.maxTargetBytes ?? 8192,
      maxPathBytes: options.maxPathBytes ?? 2048,
      maxQueryBytes: options.maxQueryBytes ?? 6144,
      maxSegments: options.maxSegments ?? 32,
      maxSegmentBytes: options.maxSegmentBytes ?? 1024,
      encodedDelimiters: options.encodedDelimiters ?? 'allow',
      blockedExtensions: options.blockedExtensions ?? SCRIPT_EXTENSION,
      blockDotfiles: options.blockDotfiles ?? true,
    };
    this.options.methods = [...this.options.methods];
    const { blockedExtensions } = this.options;

    this.extensions = Array.isArray(blockedExtensions)
      ? new Set(blockedExtensions.map((extension) => extension.replace(/^\./, '').toLowerCase()))
      : blockedExtensions && new RegExp(blockedExtensions.source, blockedExtensions.flags);
  }

  /** First rejection wins; HEAD follows the normal rendering pipeline when allowed. */
  public async handle(request: Request): Promise<IRequestGuardResult> {
    const { methods, maxTargetBytes, maxPathBytes, maxQueryBytes, decide } = this.options;

    if (!methods.includes(request.method)) {
      return this.reject(request, 'method', 405, 'Method Not Allowed', {
        Allow: methods.join(', '),
      });
    }

    let url: URL;
    const raw =
      requestTargets.get(request) ?? request.url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/\\?#]*/i, '');

    try {
      url = new URL(request.url);
    } catch {
      return this.reject(request, 'malformed-target', 400, 'Bad Request');
    }

    const { pathname, search } = url;
    const target = pathname + search;
    const rawPath = raw.split(/[?#]/, 1)[0] || '/';

    if (
      encoder.encode(target).length > maxTargetBytes ||
      encoder.encode(pathname).length > maxPathBytes ||
      encoder.encode(search.slice(1)).length > maxQueryBytes
    ) {
      return this.reject(request, 'target-too-large', 414, 'URI Too Long');
    }

    const decoded = this.decode(pathname);

    if (!decoded || !this.decode(rawPath) || raw.includes('#')) {
      return this.reject(request, 'malformed-target', 400, 'Bad Request');
    }

    if (this.isBlocked(decoded)) {
      return this.reject(request, 'blocked-extension', 404, 'Not Found');
    }

    const matches = matchRoutes(this.routes, url, this.basename) ?? [];

    if (!matches.length) {
      if (/\.[a-z0-9]{1,8}$/i.test(decoded.replace(/\/$/, ''))) {
        return this.reject(request, 'route', 404, 'Not Found');
      }

      this.notify(request, 'route', 404);

      return { matches, notFound: true, reason: 'route' };
    }

    const decision = await decide?.({ request, url, matches });

    if (decision instanceof Response) {
      this.notify(request, 'decide', decision.status);

      return { matches, response: await headResponse(request, decision), reason: 'decide' };
    }

    if (decision === 'notFound') {
      this.notify(request, 'decide', 404);

      return { matches, notFound: true, reason: 'decide' };
    }

    return { matches };
  }

  /** Check raw and decoded shapes, retaining encoded slash compatibility by default. */
  protected decode(pathname: string): string | undefined {
    const { encodedDelimiters } = this.options;

    try {
      const decoded = decodeURIComponent(pathname);

      if (
        (encodedDelimiters === 'reject' &&
          (ENCODED_DELIMITER.test(pathname) || ENCODED_DELIMITER.test(decoded))) ||
        !this.hasValidShape(pathname) ||
        !this.hasValidShape(decoded)
      ) {
        return undefined;
      }

      return decoded;
    } catch {
      return undefined;
    }
  }

  /** Enforce path depth, bytes and unambiguous traversal semantics. */
  protected hasValidShape(pathname: string): boolean {
    const { maxSegments, maxSegmentBytes } = this.options;
    const segments = pathname.split('/').filter(Boolean);

    return (
      pathname.startsWith('/') &&
      !/[\u0000-\u001f\u007f\\]/.test(pathname) &&
      !pathname.includes('//') &&
      segments.length <= maxSegments &&
      segments.every(
        (segment) =>
          segment !== '.' && segment !== '..' && encoder.encode(segment).length <= maxSegmentBytes,
      )
    );
  }

  /** Keep well-known resource routes accessible while blocking dotfiles and script probes. */
  protected isBlocked(pathname: string): boolean {
    if (
      this.options.blockDotfiles &&
      !pathname.startsWith('/.well-known/') &&
      pathname.split('/').some((segment) => segment.startsWith('.'))
    ) {
      return true;
    }

    if (this.extensions instanceof RegExp) {
      this.extensions.lastIndex = 0;

      return this.extensions.test(pathname);
    }

    return Boolean(
      this.extensions &&
      this.extensions.has(pathname.replace(/\/$/, '').split('.').pop()!.toLowerCase()),
    );
  }

  /** Produce short, private guard responses without a HEAD body. */
  protected reject(
    request: Request,
    reason: TRequestGuardReason,
    status: number,
    body: string,
    headers?: HeadersInit,
  ): IRequestGuardResult {
    this.notify(request, reason, status);

    return {
      matches: [],
      reason,
      response: new Response(request.method === 'HEAD' ? null : body, {
        status,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'private, no-store',
          ...headers,
        },
      }),
    };
  }

  /** Observability hooks must never change request handling. */
  protected notify(request: Request, reason: TRequestGuardReason, status: number): void {
    try {
      this.options.onReject?.({ request, reason, status });
    } catch {
      /** Rejection reporting is best effort. */
    }
  }
}

export default RequestGuard;
