import { isbot } from 'isbot';
import { pathToRegexp } from 'path-to-regexp';
import type { StaticHandler } from 'react-router';
import { matchPath } from 'react-router';
import type Diagnostics from '@services/diagnostics';

type TRenderMode = 'ssr' | 'spa';

interface ISsrPolicy {
  /** Select all routes by default. */
  mode?: 'all' | 'include' | 'exclude';
  routes?: (string | RegExp)[];

  /** Render crawlers with SSR by default, regardless of route policy. */
  bots?: 'ssr' | 'policy';

  /** Return undefined to keep the matched policy decision. */
  decide?: (params: { request: Request; url: URL; isBot: boolean }) => TRenderMode | undefined;
}

interface IPolicyPattern {
  pattern: string | RegExp;
  exclude: boolean;
  test: (pathname: string) => boolean;
}

/**
 * Compile once without sharing mutable RegExp.lastIndex with application code.
 */
const compilePattern = (pattern: string | RegExp, exclude: boolean): IPolicyPattern => {
  if (pattern === '') {
    throw new Error('SSR route patterns cannot be empty.');
  }

  const regexp =
    typeof pattern === 'string'
      ? pathToRegexp(pattern).regexp
      : new RegExp(pattern.source, pattern.flags);

  return {
    pattern,
    exclude,

    /**
     * Reset stateful expressions before checking each pathname.
     */
    test: (pathname) => {
      regexp.lastIndex = 0;

      return regexp.test(pathname);
    },
  };
};

/**
 * Collect URL paths alongside their route ids without resolving lazy modules or loaders.
 */
const routePaths = (
  routes: StaticHandler['dataRoutes'],
  parent = '',
): { id: string; path: string }[] =>
  routes.flatMap(({ id, path: routePath, children }) => {
    const path =
      (routePath?.startsWith('/') ? routePath : `${parent}/${routePath ?? ''}`)
        .replace(/\/+/g, '/')
        .replace(/\/$/, '') || '/';

    return [{ id, path }, ...routePaths(children ?? [], path)];
  });

/**
 * Snapshot environment policy when the application entry/handler is created at startup.
 */
class SsrPolicy {
  /**
   * Skip policy work when every request uses SSR.
   */
  public readonly active: boolean;

  /**
   * Keep policy paths aligned with the router's mount path.
   */
  public readonly basename: string;

  /**
   * Retain compiled inclusion and exclusion checks.
   */
  protected readonly patterns: IPolicyPattern[];

  /**
   * Choose how unmatched requests are rendered.
   */
  protected readonly mode: NonNullable<ISsrPolicy['mode']>;

  /**
   * Control whether crawlers bypass route policy.
   */
  protected readonly bots: NonNullable<ISsrPolicy['bots']>;

  /**
   * Allow application decisions after route matching.
   */
  protected readonly decide?: ISsrPolicy['decide'];

  /**
   * Identify the effective configuration in diagnostics.
   */
  protected readonly source: string;

  /**
   * Retain declared paths for policy diagnostics.
   */
  protected readonly paths: ReturnType<typeof routePaths>;

  /**
   * Inspect configured patterns only once per policy.
   */
  protected hasInspected = false;

  /**
   * Compile the startup policy with environment overrides taking precedence.
   */
  public constructor(
    { mode = 'all', routes = [], bots = 'ssr', decide }: ISsrPolicy = {},
    dataRoutes: StaticHandler['dataRoutes'] = [],
    basename = '/',
    env = typeof process === 'undefined' ? undefined : process.env.SSR_BOOST_SSR_ROUTES,
  ) {
    this.basename = basename;
    this.bots = bots;

    /**
     * Prefix declared paths with the router's configured basename.
     */
    this.paths = routePaths(dataRoutes).map((route) => ({
      ...route,
      path: `${basename.replace(/\/$/, '')}${route.path}`,
    }));

    if (env !== undefined) {
      const values = env
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      this.mode = !values.length
        ? 'all'
        : values.some((value) => !value.startsWith('!'))
          ? 'include'
          : 'exclude';

      /**
       * Compile environment entries with their explicit exclusion markers.
       */
      this.patterns = values.map((value) => {
        const isExcluded = value.startsWith('!');

        return compilePattern(isExcluded ? value.slice(1) : value, isExcluded);
      });
      this.source = 'SSR_BOOST_SSR_ROUTES';
    } else {
      this.mode = mode;
      this.patterns =
        mode === 'all' ? [] : routes.map((pattern) => compilePattern(pattern, mode === 'exclude'));
      this.decide = decide;
      this.source = 'config';
    }

    this.active = this.mode !== 'all' || Boolean(this.decide);
  }

  /**
   * Crawler protection wins over both runtime decisions and environment rollback rules.
   */
  public select(request: Request, diagnostics?: Diagnostics): TRenderMode {
    if (!this.active) {
      return 'ssr';
    }

    this.inspect(diagnostics);

    const { url: requestUrl, headers } = request;
    const url = new URL(requestUrl);
    const isBot = isbot(headers.get('user-agent'));
    const matched = this.patterns.filter(({ test }) => test(url.pathname));
    const excluded = matched.find(({ exclude }) => exclude);
    let mode: TRenderMode =
      excluded || (this.mode === 'include' && !matched.length) ? 'spa' : 'ssr';
    let source = `${this.source} ${this.mode}`;

    if (isBot && this.bots === 'ssr') {
      mode = 'ssr';
      source = 'bots: ssr';
    } else {
      const decision = this.decide?.({ request, url, isBot });

      if (decision !== undefined) {
        mode = decision;
        source = 'config decide';
      }
    }

    const pattern =
      excluded?.pattern ??
      matched[0]?.pattern ??
      [...this.paths].reverse().find(({ path }) => matchPath(path, url.pathname))?.path ??
      '(unmatched URL)';

    diagnostics?.policyDecision(String(pattern), mode, source);

    return mode;
  }

  /**
   * Explain typos using declared paths, including concrete URLs for dynamic route ids.
   * A global 404 catch-all must not hide a misspelled policy.
   */
  protected inspect(diagnostics?: Diagnostics): void {
    if (!diagnostics || this.hasInspected) {
      return;
    }

    this.hasInspected = true;

    for (const { pattern, test } of this.patterns) {
      /**
       * Check declared paths without allowing a catch-all to hide policy typos.
       */
      const hasMatch = this.paths.some(
        ({ path }) =>
          path !== '/*' &&
          (test(path) || (typeof pattern === 'string' && Boolean(matchPath(path, pattern)))),
      );

      if (!hasMatch) {
        diagnostics.policyUnmatched(String(pattern));
      }
    }
  }
}

export type { ISsrPolicy, TRenderMode };

export default SsrPolicy;
