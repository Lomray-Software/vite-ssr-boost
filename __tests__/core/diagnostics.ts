// @vitest-environment node
import { createStaticHandler } from 'react-router';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import createHandler from '@core/handler';
import type { ICreateHandlerOptions } from '@core/handler';
import type { TRenderToStream } from '@core/render';
import Diagnostics, { isDiagnosticsEnabled } from '@services/diagnostics';
import Logger from '@services/logger';

const docs = 'https://lomray-software.github.io/vite-ssr-boost/reference/diagnostics#';
const hydration = '<script>window.__staticRouterHydrationData = {};</script>';
let counter = 0;
let pathname: string;
let warn: MockInstance<Logger['warn']>;

const fakeRenderer =
  (chunks: string[]): TRenderToStream =>
  () => ({
    abort: vi.fn(),
    allReady: Promise.resolve(),
    shellReady: Promise.resolve(),
    start: vi.fn(),
    stream: new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
        controller.close();
      },
    }),
  });

const fixture = (
  options: Partial<ICreateHandlerOptions<Record<string, unknown>>> = {},
  chunks = ['<main>content</main>'],
  data: unknown = null,
) =>
  createHandler(
    {
      createApp: (children) => children,
      handler: createStaticHandler([
        {
          id: pathname.slice(1),
          path: '*',
          loader: () => data,
          action: () => data,
          Component: () => null,
        },
      ]),
      renderToStream: fakeRenderer(chunks),
    },
    {
      getHtml: () => ({ header: '<html><head></head><body>', footer: '</body></html>' }),
      ...options,
    },
  );

const request = (method = 'GET') => new Request(`https://example.test${pathname}`, { method });
const messages = (): string[] => warn.mock.calls.map(([message]) => message as string);

beforeEach(() => {
  pathname = `/diagnostics-${++counter}`;
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('SSR_BOOST_DIAGNOSTICS', undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('createHandler diagnostics', () => {
  it.each(['GET', 'POST'])('identifies the route and nested %s data path', async (method) => {
    const handler = fixture({}, undefined, { items: [{ result: () => 1 }] });
    await (await handler(request(method))).text();
    const kind = method === 'POST' ? 'actionData' : 'loaderData';
    expect(messages()).toContain(
      `[ssr-boost] SSR_BOOST_LOADER_NOT_SERIALIZABLE: Route "${pathname.slice(1)}" at ${kind}["${pathname.slice(1)}"].items[0].result: function is not JSON-serializable. See ${docs}ssr_boost_loader_not_serializable`,
    );
  });

  it('supports promises and BigInt without diagnostics', async () => {
    await (
      await fixture({}, undefined, { count: 1n, pending: Promise.resolve(1) })(request())
    ).text();
    expect(messages()).toEqual([]);
  });

  it('checks getState, including values omitted by the state builder', async () => {
    const handler = fixture({
      getState: () => ({ app: { nested: [new Date('2026-01-01')] }, emptyMap: new Map() }),
    });
    await (await handler(request())).text();
    expect(messages()).toEqual([
      `[ssr-boost] SSR_BOOST_STATE_NOT_SERIALIZABLE: getState for route "${pathname}" at $.app.nested[0]: Date hydrates as a string. See ${docs}ssr_boost_state_not_serializable`,
      `[ssr-boost] SSR_BOOST_STATE_NOT_SERIALIZABLE: getState for route "${pathname}" at $.emptyMap: Map is not JSON-serializable. See ${docs}ssr_boost_state_not_serializable`,
    ]);
  });

  it.each([
    { header: '<html></html>', footer: undefined as never },
    { header: '<!--ssr-outlet-->', footer: '' },
    { header: '', footer: '<!--ssr-outlet-->' },
  ])('reports invalid split shells %j', async (shell) => {
    await (await fixture({ getHtml: () => shell })(request())).text();
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain('SSR_BOOST_OUTLET_MISSING:');
    expect(messages()[0]).toContain(`route "${pathname}"`);
  });

  it.each(['withhold', 'transform'])('reports a hydration footer lost by %s', async (mode) => {
    const handler = fixture({
      onResponse: ({ html }) =>
        mode === 'withhold' && html.includes('window.__staticRouterHydrationData')
          ? ''
          : html.replace(/<script async>window\.__staticRouterHydrationData.*?<\/script>/, ''),
    });
    await (await handler(request())).text();
    expect(messages()).toEqual([
      `[ssr-boost] SSR_BOOST_HYDRATION_STATE_MISSING: Completed response for route "${pathname}" has no window.__staticRouterHydrationData script; preserve the hydration footer in onResponse. See ${docs}ssr_boost_hydration_state_missing`,
    ]);
  });

  it.each([
    ['<html>', '<HTML lang="en">'],
    ['<head>', '<head data-source="manager">'],
    ['window.__staticRouterHydrationData', hydration],
    ['id="S:1"', '<div id="S:1"></div><div id="S:1"></div>'],
    ['id="B:1"', '<template id="B:1"></template><template id="B:1"></template>'],
    ['$RC("B:1")', '<script>$RC("B:1","S:1");$RC("B:1","S:1");</script>'],
  ])('reports repeated %s even when split between chunks', async (marker, body) => {
    const handler = fixture({}, [...body]);
    await (await handler(request())).text();
    expect(messages()).toEqual([
      `[ssr-boost] SSR_BOOST_DUPLICATE_OUTPUT: Completed response for route "${pathname}" repeats ${marker}; onResponse must return undefined to keep a chunk and '' to withhold one. See ${docs}ssr_boost_duplicate_output`,
    ]);
  });

  it('diagnoses the output appended by the final hook call', async () => {
    let retained = '';
    const handler = fixture({
      onResponse: ({ html, isEnd }) => {
        if (isEnd) return retained;
        retained += html;
        return undefined;
      },
    });
    await (await handler(request())).text();
    expect(messages()).toHaveLength(3);
    expect(messages().every((message) => message.includes('SSR_BOOST_DUPLICATE_OUTPUT:'))).toBe(
      true,
    );
  });

  it.each([
    [Promise.resolve('chunk'), 'Promise'],
    [{ html: 'chunk' }, 'Object'],
    [null, 'null'],
    [42, 'number'],
    [false, 'boolean'],
    [() => 'chunk', 'function'],
  ])('reports an invalid onResponse return %s as %s', async (value, type) => {
    const handler = fixture({
      onResponse: ({ html }) => (html.includes('<main>') ? (value as never) : undefined),
    });
    await (await handler(request())).text();
    expect(messages()).toEqual([
      `[ssr-boost] SSR_BOOST_ONRESPONSE_INVALID_RETURN: onResponse for route "${pathname}" returned ${type}; return a string or undefined. See ${docs}ssr_boost_onresponse_invalid_return`,
    ]);
  });

  it('checks invalid returns on the final hook call too', async () => {
    await (
      await fixture({ onResponse: ({ isEnd }) => (isEnd ? ({} as never) : undefined) })(request())
    ).text();
    expect(messages()[0]).toContain('SSR_BOOST_ONRESPONSE_INVALID_RETURN:');
  });

  it('accepts normal React markers, raw text and correctly retained hook output', async () => {
    let retained = '';
    const handler = fixture(
      {
        getState: () => ({ app: { example: '<html><head>' } }),
        onResponse: ({ html, isEnd }) => {
          retained += html;
          return isEnd ? retained : '';
        },
      },
      [
        '<!-- <html><head><div id="S:0"> -->',
        '<script>const example = "<html><head><div id=\'S:0\'>";</script>',
        '<style>/* <html><head> */</style><textarea><html><head></textarea>',
        '<div data-example="<html><head>" title=\'id="S:0"\'></div>',
        '<template id="B:0"></template><div hidden id="S:0"></div>',
        '<script>$RC("B:0", "S:0");</script>',
      ],
    );
    await (await handler(request())).text();
    expect(messages()).toEqual([]);
  });

  it.each(['HEAD', 'redirect', '204', 'shell-error'])(
    'skips completed-body checks for %s',
    async (mode) => {
      const append = vi.spyOn(Diagnostics.prototype, 'append');
      const handler = fixture({
        onRequest: () => {
          if (mode === 'redirect') return Response.redirect('https://example.test/next');
          return { status: mode === '204' ? 204 : undefined };
        },
        onRouterReady: () => {
          if (mode === 'shell-error') throw new Error('pre-render failure');
          return {};
        },
      });
      if (mode === 'shell-error') {
        await expect(handler(request())).rejects.toThrow('pre-render failure');
      } else {
        await (await handler(request(mode === 'HEAD' ? 'HEAD' : 'GET'))).text();
      }
      expect(append).not.toHaveBeenCalled();
      expect(messages()).toEqual([]);
    },
  );

  it.each([
    ['production', undefined, undefined, false],
    ['development', false, undefined, false],
    ['development', true, '0', false],
    ['production', true, '0', false],
    ['production', false, '1', true],
    ['production', undefined, '1', true],
    ['production', true, undefined, true],
    ['development', undefined, undefined, true],
  ] as const)(
    'resolves NODE_ENV=%s option=%s override=%s to %s without disabled walks or buffering',
    async (environment, option, override, enabled) => {
      vi.stubEnv('NODE_ENV', environment);
      vi.stubEnv('SSR_BOOST_DIAGNOSTICS', override);
      const append = vi.spyOn(Diagnostics.prototype, 'append');
      const routerWalk = vi.spyOn(Diagnostics.prototype, 'inspectRouterState');
      const stateWalk = vi.spyOn(Diagnostics.prototype, 'inspectState');
      const handler = fixture(
        { diagnostics: option, getState: () => ({ app: { map: new Map() } }) },
        ['<head></head>'],
        { pending: Promise.resolve(1) },
      );
      await (await handler(request())).text();
      expect(append.mock.calls.length > 0).toBe(enabled);
      expect(routerWalk.mock.calls.length > 0).toBe(enabled);
      expect(stateWalk.mock.calls.length > 0).toBe(enabled);
      expect(messages().length > 0).toBe(enabled);
    },
  );

  it('works in Fetch runtimes without process globals', async () => {
    vi.stubGlobal('process', undefined);
    try {
      expect(isDiagnosticsEnabled()).toBe(true);
      expect(isDiagnosticsEnabled(false)).toBe(false);
      await (await fixture({ diagnostics: false })(request())).text();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('deduplicates the six state/output codes across requests and handler instances', async () => {
    pathname = '/diagnostics-proof';
    const options = {
      getHtml: () => ({ header: '<html><head></head><body>', footer: undefined as never }),
      getState: () => ({ app: { cache: new Map() } }),
      onResponse: ({ html }: { html: string }) => {
        if (html.includes('window.__staticRouterHydrationData')) return '';
        if (html.includes('<main>')) return {} as never;
        return undefined;
      },
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const handler = fixture(options, ['<head></head>', '<main>body</main>'], {
        unsupported: () => 1,
      });
      await (await handler(request())).text();
      await (await handler(request())).text();
    }
    expect(messages()).toHaveLength(6);
    expect(new Set(messages().map((message) => message.match(/SSR_BOOST_[A-Z_]+/)![0])).size).toBe(
      6,
    );
    if (process.env.SSR_BOOST_DIAGNOSTICS_PROOF === '1') {
      process.stdout.write(`${messages().join('\n')}\n`);
    }
  });
});
