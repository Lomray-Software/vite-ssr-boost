import type { StaticHandlerContext } from 'react-router';
import Logger from '@services/logger';

type TDiagnosticCode =
  | 'SSR_BOOST_LOADER_NOT_SERIALIZABLE'
  | 'SSR_BOOST_STREAM_PROMISE_ABORTED'
  | 'SSR_BOOST_STATE_NOT_SERIALIZABLE'
  | 'SSR_BOOST_OUTLET_MISSING'
  | 'SSR_BOOST_HYDRATION_STATE_MISSING'
  | 'SSR_BOOST_DUPLICATE_OUTPUT'
  | 'SSR_BOOST_ONRESPONSE_INVALID_RETURN';

interface ISerializationIssue {
  path: string;
  reason: string;
}

const OUTLET = '<!--ssr-outlet-->';
const HYDRATION = 'window.__staticRouterHydrationData';
const warnedKey = Symbol.for('@lomray/vite-ssr-boost/diagnostics');
// Retain deduplication across managed development module reloads and package copies.
const registry = globalThis as typeof globalThis & { [warnedKey]?: Set<string> };

/**
 * Resolve overrides without requiring Node globals in Fetch runtimes.
 */
const isDiagnosticsEnabled = (enabled?: boolean): boolean => {
  const env = typeof process === 'undefined' ? undefined : process.env;

  if (env?.SSR_BOOST_DIAGNOSTICS === '0' || env?.SSR_BOOST_DIAGNOSTICS === '1') {
    return env.SSR_BOOST_DIAGNOSTICS === '1';
  }

  return enabled ?? env?.NODE_ENV !== 'production';
};

/**
 * Keep warnings and fatal shell errors linked to the same stable reference.
 */
const formatDiagnostic = (code: TDiagnosticCode, sentence: string): string =>
  `[ssr-boost] ${code}: ${sentence} See https://lomray-software.github.io/vite-ssr-boost/reference/diagnostics#${code.toLowerCase()}`;

/**
 * Reject unusable file-backed shells in every runtime mode.
 */
const splitHtmlShell = (html: string, file: string, outlet = OUTLET): [string, string] => {
  const parts = html.split(outlet);

  if (!outlet || parts.length !== 2) {
    throw new Error(
      formatDiagnostic(
        'SSR_BOOST_OUTLET_MISSING',
        `Invalid HTML shell in ${JSON.stringify(file)}: expected exactly one non-empty outlet ${JSON.stringify(outlet)}.`,
      ),
    );
  }

  return parts as [string, string];
};

/**
 * Describe runtime values without serializing their contents.
 */
const valueType = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  if (typeof value !== 'object') {
    const names: Record<string, string> = { bigint: 'BigInt', symbol: 'Symbol' };

    return names[typeof value] ?? typeof value;
  }

  const prototype = Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null;
  const name = prototype?.constructor?.name;

  return typeof name === 'string' && name ? name : 'object';
};

/**
 * Custom state uses JSON. Router state also supports promises, Date, RegExp, bigint,
 * Map and Set through the stream codec; functions, symbols, classes and cycles warn.
 */
const walkSerializable = (
  value: unknown,
  report: (issue: ISerializationIssue) => void,
  path = '$',
  ancestors = new Set<object>(),
  streamed = false,
): void => {
  const type = typeof value;

  if (
    streamed &&
    (value instanceof Promise ||
      value instanceof Date ||
      value instanceof RegExp ||
      type === 'bigint')
  ) {
    return;
  }

  if (type === 'function' || type === 'bigint' || type === 'symbol') {
    report({ path, reason: `${valueType(value)} is not JSON-serializable` });

    return;
  }

  if (value === null || type !== 'object') {
    return;
  }

  const object = value as object;
  const prototype: unknown = Object.getPrototypeOf(object);

  if (
    !(streamed && (object instanceof Map || object instanceof Set)) &&
    prototype !== Object.prototype &&
    prototype !== null &&
    !(Array.isArray(object) && prototype === Array.prototype)
  ) {
    const name = valueType(object);

    report({
      path,
      reason: name === 'Date' ? 'Date hydrates as a string' : `${name} is not JSON-serializable`,
    });

    return;
  }

  if (ancestors.has(object)) {
    report({ path, reason: 'a circular reference is not JSON-serializable' });

    return;
  }

  ancestors.add(object);

  const entries =
    streamed && object instanceof Map
      ? [...(object as Map<unknown, unknown>)].flatMap(([key, child], index) => [
          [`${index}.key`, key],
          [`${index}.value`, child],
        ])
      : streamed && object instanceof Set
        ? [...(object as Set<unknown>)].map((child, index) => [String(index), child])
        : Object.entries(object);

  for (const [key, child] of entries as [string, unknown][]) {
    const suffix =
      Array.isArray(object) && /^(0|[1-9]\d*)$/.test(key)
        ? `[${key}]`
        : /^[A-Za-z_$][\w$]*$/.test(key)
          ? `.${key}`
          : `[${JSON.stringify(key)}]`;

    walkSerializable(child, report, path + suffix, ancestors, streamed);
  }

  ancestors.delete(object);
};

/**
 * Inspect one development response while allowing every chunk to stream immediately.
 */
class Diagnostics {
  protected chunks: string[] = [];

  public constructor(
    protected readonly route: string,
    protected readonly logger: Pick<Logger, 'warn'> = new Logger(),
  ) {}

  /**
   * Emit each concrete message once per process, including across handler instances.
   */
  protected warn(code: TDiagnosticCode, detail: string): void {
    const message = formatDiagnostic(code, detail);
    const warned = (registry[warnedKey] ??= new Set<string>());

    if (!warned.has(message)) {
      warned.add(message);
      this.logger.warn(message, {});
    }
  }

  /**
   * A split Fetch shell has one insertion boundary and must not retain raw outlets.
   */
  public inspectShell({ header, footer }: { header: string; footer: string }): void {
    if (
      typeof header !== 'string' ||
      typeof footer !== 'string' ||
      header.includes(OUTLET) ||
      footer.includes(OUTLET)
    ) {
      this.warn(
        'SSR_BOOST_OUTLET_MISSING',
        `HTML shell for route ${JSON.stringify(this.route)} must supply both header and footer around exactly one ${OUTLET} outlet, with no outlet left in either half.`,
      );
    }
  }

  /**
   * Include React Router's route id and the full loader/action key path.
   */
  public inspectRouterState({ loaderData, actionData }: StaticHandlerContext): void {
    for (const [kind, data] of Object.entries({ loaderData, actionData })) {
      for (const [route, value] of Object.entries(data ?? {})) {
        walkSerializable(
          value,
          ({ path, reason }) =>
            this.warn(
              'SSR_BOOST_LOADER_NOT_SERIALIZABLE',
              `Route ${JSON.stringify(route)} at ${path}: ${reason}.`,
            ),
          `${kind}[${JSON.stringify(route)}]`,
          new Set(),
          true,
        );
      }
    }
  }

  /** Report the request's pending loader/action promises at the render deadline. */
  public streamAborted(count: number): void {
    this.warn(
      'SSR_BOOST_STREAM_PROMISE_ABORTED',
      `Route ${JSON.stringify(this.route)} aborted with ${count} pending loader/action promise(s); the browser receives a rejection when connected.`,
    );
  }

  /** Inspect streamed resolutions with the same supported value matrix as initial data. */
  public inspectStreamValue(value: unknown, id: number): void {
    walkSerializable(
      value,
      ({ path, reason }) =>
        this.warn(
          'SSR_BOOST_LOADER_NOT_SERIALIZABLE',
          `Route ${JSON.stringify(this.route)} at ${path}: ${reason}.`,
        ),
      `promise[${id}]`,
      new Set(),
      true,
    );
  }

  /**
   * Check custom state before the serializer can omit or coerce it.
   */
  public inspectState(state: unknown): void {
    walkSerializable(state, ({ path, reason }) =>
      this.warn(
        'SSR_BOOST_STATE_NOT_SERIALIZABLE',
        `getState for route ${JSON.stringify(this.route)} at ${path}: ${reason}.`,
      ),
    );
  }

  /**
   * Hooks are synchronous and can only keep, replace or withhold a chunk.
   */
  public inspectOnResponse(value: unknown): void {
    if (value !== undefined && typeof value !== 'string') {
      this.warn(
        'SSR_BOOST_ONRESPONSE_INVALID_RETURN',
        `onResponse for route ${JSON.stringify(this.route)} returned ${valueType(value)}; return a string or undefined.`,
      );
    }
  }

  /**
   * Retain only the output that actually leaves the response transform.
   */
  public append(html: string): void {
    this.chunks.push(html);
  }

  /**
   * Scan completed HTML so markers split across chunks are still recognized.
   */
  public complete(): void {
    const html = this.chunks.join('');

    this.chunks = [];

    const markers = new Map<string, number>();
    const count = (marker: string): void => {
      markers.set(marker, (markers.get(marker) ?? 0) + 1);
    };
    // Skip comments and raw text so markup examples and state strings are not tags.
    const markup = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(
        /(<(script|style|textarea|title)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)([\s\S]*?)<\/\2\s*>/gi,
        (_tag, opening: string, name: string, content: string) => {
          if (name.toLowerCase() === 'script') {
            if (/\bwindow\.__staticRouterHydrationData\s*=/.test(content)) {
              count(HYDRATION);
            }

            for (const match of content.matchAll(/\$RC\s*\(\s*(["'])(B:[^"']+)\1/g)) {
              count(`$RC("${match[2]}")`);
            }
          }

          return opening;
        },
      );

    for (const match of markup.matchAll(/<([a-z][\w:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi)) {
      const name = match[1].toLowerCase();

      if (name === 'html' || name === 'head') {
        count(`<${name}>`);
      }

      for (const attribute of match[2].matchAll(
        /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
      )) {
        const value = attribute[2] ?? attribute[3] ?? attribute[4];

        if (attribute[1].toLowerCase() === 'id' && /^(S|B):/.test(value)) {
          count(`id="${value}"`);
        }
      }
    }

    if (!markers.has(HYDRATION)) {
      this.warn(
        'SSR_BOOST_HYDRATION_STATE_MISSING',
        `Completed response for route ${JSON.stringify(this.route)} has no ${HYDRATION} script; preserve the hydration footer in onResponse.`,
      );
    }

    for (const [marker, total] of markers) {
      if (total > 1) {
        this.warn(
          'SSR_BOOST_DUPLICATE_OUTPUT',
          `Completed response for route ${JSON.stringify(this.route)} repeats ${marker}; onResponse must return undefined to keep a chunk and '' to withhold one.`,
        );
      }
    }
  }
}

export { formatDiagnostic, isDiagnosticsEnabled, splitHtmlShell, walkSerializable };

export type { ISerializationIssue, TDiagnosticCode };

export default Diagnostics;
