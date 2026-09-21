// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentRequest, handlerFixture, streamRenderer } from '@__helpers__/request-handler';
import Admission, { readSsrMaxConcurrency, resolveSsrMaxConcurrency } from '@core/admission';
import type { IAdmissionEvent } from '@core/admission';

vi.mock('@core/admission', { spy: true });
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('resolveSsrMaxConcurrency (ported reference)', () => {
  it.each([undefined, '', '0', '-1', '1.5', 'invalid', 'Infinity', '9007199254740992'])(
    'disables the override for %s',
    (value) => {
      expect(resolveSsrMaxConcurrency(value)).toBeUndefined();
    },
  );
  it('accepts a positive safe integer', () => {
    expect(resolveSsrMaxConcurrency('24')).toBe(24);
    expect(resolveSsrMaxConcurrency(' 24 ')).toBe(24);
  });
  it('reads defensively without process or env', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')!;
    try {
      Reflect.deleteProperty(globalThis, 'process');
      expect(readSsrMaxConcurrency()).toBeUndefined();
      Object.defineProperty(globalThis, 'process', { configurable: true, value: {} });
      expect(readSsrMaxConcurrency()).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'process', descriptor);
    }
  });
});

describe('Admission (ported reference lifecycle)', () => {
  it('rejects immediately at capacity without a queue and releases once', () => {
    const onEvent = vi.fn();
    const controller = new Admission(2, { onEvent });
    const first = controller.tryAcquire()!;
    const second = controller.tryAcquire()!;
    expect(controller.tryAcquire()).toBeUndefined();
    expect(controller.activeRequests).toBe(2);
    first.release('abort');
    first.release('finish');
    expect(controller.activeRequests).toBe(1);
    expect(onEvent.mock.calls.filter(([event]) => event.durationMs !== undefined)).toHaveLength(1);
    expect(controller.tryAcquire()).toBeDefined();
    second.release('finish');
  });

  it('returns a minimal no-store overload response', async () => {
    const controller = new Admission(1);
    const response = await controller.reject(documentRequest());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Service Unavailable');
    expect(response.headers.get('Retry-After')).toBe('1');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect((await controller.reject(documentRequest('/', { method: 'HEAD' }))).body).toBeNull();
  });

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid constructor limit %s',
    (limit) => {
      expect(() => new Admission(limit)).toThrow(
        'SSR concurrency limit must be a positive integer.',
      );
    },
  );
});

describe('real render admission', () => {
  it('never constructs the controller when no valid limit is configured', async () => {
    vi.stubEnv('SSR_MAX_CONCURRENCY', 'invalid');
    vi.mocked(Admission).mockClear();
    const fixture = handlerFixture({
      admission: {
        onEvent: () => {
          throw new Error('unused');
        },
      },
    });
    const response = await fixture.fetch(documentRequest());
    await response.text();
    expect(Admission).not.toHaveBeenCalled();
  });

  it('snapshots a valid env override at handler creation', async () => {
    vi.stubEnv('SSR_MAX_CONCURRENCY', '1');
    const fixture = handlerFixture({ admission: { maxConcurrency: 10 } });
    vi.stubEnv('SSR_MAX_CONCURRENCY', '100');
    const first = await fixture.fetch(documentRequest());
    expect((await fixture.fetch(documentRequest())).status).toBe(503);
    await first.text();
    expect((await fixture.fetch(documentRequest())).status).toBe(200);
  });

  it('releases only after the final stream is consumed and admits the next request', async () => {
    const onEvent = vi.fn();
    const fixture = handlerFixture({ admission: { maxConcurrency: 1, onEvent } });
    const first = await fixture.fetch(documentRequest());
    expect(onEvent.mock.calls.map(([event]) => event.outcome)).toEqual(['admitted']);
    expect((await fixture.fetch(documentRequest())).status).toBe(503);
    await first.text();
    expect(onEvent.mock.calls.map(([event]) => event.outcome)).toEqual([
      'admitted',
      'rejected',
      'finish',
    ]);
    expect(onEvent.mock.calls[2][0]).toMatchObject({ active: 0, durationMs: expect.any(Number) });
    await (await fixture.fetch(documentRequest())).text();
  });

  it('releases exactly once for cancellation racing with request abort', async () => {
    const onEvent = vi.fn();
    const signal = new AbortController();
    const renderer = streamRenderer(true);
    const fixture = handlerFixture(
      { admission: { maxConcurrency: 1, onEvent } },
      undefined,
      renderer,
    );
    const response = await fixture.fetch(documentRequest('/', { signal: signal.signal }));
    const reader = response.body!.getReader();
    await reader.read();
    const pending = reader.read();
    signal.abort('disconnect');
    await reader.cancel('cancel');
    await pending;
    const terminal = onEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event.durationMs !== undefined);
    expect(terminal).toEqual([{ outcome: 'abort', active: 0, durationMs: expect.any(Number) }]);
    expect(renderer.cancel).toHaveBeenCalledOnce();
  });

  it('releases unread response slots on request disconnect', async () => {
    const onEvent = vi.fn();
    const signal = new AbortController();
    const fixture = handlerFixture({ admission: { maxConcurrency: 1, onEvent } });
    const first = await fixture.fetch(documentRequest('/', { signal: signal.signal }));
    signal.abort();
    await first.body?.cancel();
    expect(onEvent.mock.calls.map(([event]) => event.outcome)).toEqual(['admitted', 'abort']);
  });

  it.each(['stream', 'transform', 'render', 'app'] as const)(
    'releases exactly once on %s error',
    async (kind) => {
      const onEvent = vi.fn();
      const renderer = streamRenderer(kind === 'stream');
      const fixture = handlerFixture(
        {
          admission: { maxConcurrency: 1, onEvent },
          ...(kind === 'transform'
            ? {
                onResponse: () => {
                  throw new Error('transform');
                },
              }
            : {}),
        },
        undefined,
        renderer,
      );
      if (kind === 'render') {
        renderer.renderToStream.mockImplementation(() => {
          throw new Error('render');
        });
      }
      if (kind === 'app') {
        fixture.createApp.mockImplementation(() => {
          throw new Error('app');
        });
      }
      if (kind === 'app') {
        await expect(fixture.fetch(documentRequest())).rejects.toThrow('app');
      } else {
        const response = await fixture.fetch(documentRequest());
        if (kind === 'stream') {
          renderer.error(new Error('stream'));
        }
        if (kind === 'render') {
          expect(response.status).toBe(500);
          await response.text();
        } else {
          await expect(response.text()).rejects.toThrow(kind);
        }
      }
      expect(onEvent.mock.calls.map(([event]) => event.outcome)).toEqual(['admitted', 'error']);
    },
  );

  it.each(['HEAD', '204', '205', '304', 'redirect'])(
    'releases exactly once for %s early return',
    async (kind) => {
      const onEvent = vi.fn();
      const fixture = handlerFixture({
        admission: { maxConcurrency: 1, onEvent },
        onShellReady: ({ context }) => {
          if (/^\d+$/.test(kind)) {
            context.response.status = Number(kind);
          }
          return {};
        },
      });
      if (kind === 'redirect') {
        fixture.createApp.mockImplementation((children, context) => {
          context.serverContext!.response = Response.redirect('https://example.test/next');
          return children;
        });
      }
      const response = await fixture.fetch(
        documentRequest('/', { method: kind === 'HEAD' ? 'HEAD' : 'GET' }),
      );
      expect(response.status).toBe(
        kind === 'redirect' ? 302 : kind === 'HEAD' ? 200 : Number(kind),
      );
      await response.text();
      expect(onEvent.mock.calls.map(([event]) => event.outcome)).toEqual(['admitted', 'finish']);
    },
  );

  it('does not admit guard rejections, SPA shells, request bypasses or cache hits, and holds a slot only while a loader redirect runs', async () => {
    const onEvent = vi.fn();
    const admission = { maxConcurrency: 1, onEvent };
    const guard = handlerFixture({ admission });
    await (await guard.fetch(documentRequest('/x.php'))).text();
    const spa = handlerFixture({ admission, ssr: { mode: 'include' } });
    await (await spa.fetch(documentRequest())).text();
    const bypass = handlerFixture({ admission, onRequest: () => new Response('bypass') });
    await (await bypass.fetch(documentRequest())).text();
    expect(onEvent).not.toHaveBeenCalled();
    const redirect = handlerFixture({ admission }, [
      { path: '/', loader: () => Response.redirect('https://example.test/next') },
    ]);
    await (await redirect.fetch(documentRequest())).text();
    expect(onEvent.mock.calls.map(([event]) => event.outcome)).toEqual(['admitted', 'finish']);
    onEvent.mockClear();
    const cached = handlerFixture({ admission, notFound: 'cached' });
    await (await cached.fetch(documentRequest('/missing'))).text();
    expect(onEvent.mock.calls.map(([event]) => event.outcome)).toEqual(['admitted', 'finish']);
    await (await cached.fetch(documentRequest('/another'))).text();
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('uses overload SPA with 200 for humans and 503 for bots without a second render', async () => {
    const fixture = handlerFixture({ admission: { maxConcurrency: 1, overload: 'spa' } });
    const first = await fixture.fetch(documentRequest());
    const human = await fixture.fetch(documentRequest());
    expect(human.status).toBe(200);
    expect(human.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await human.text()).toContain('data-force-spa');
    const bot = await fixture.fetch(
      documentRequest('/', { headers: { 'User-Agent': 'Googlebot' } }),
    );
    expect(bot.status).toBe(503);
    expect(await bot.text()).toBe('Service Unavailable');
    expect(fixture.renderToStream).toHaveBeenCalledOnce();
    await first.text();
  });

  it('serves a custom overload page as a private 503 for every consumer', async () => {
    const overload = vi.fn(
      () =>
        new Response('<h1>Busy</h1>', {
          headers: { 'Content-Type': 'text/html', 'X-Page': 'busy' },
        }),
    );
    const fixture = handlerFixture({ admission: { maxConcurrency: 1, overload } });
    const first = await fixture.fetch(documentRequest());

    for (const method of ['GET', 'HEAD']) {
      const response = await fixture.fetch(documentRequest('/', { method }));

      expect(response.status).toBe(503);
      expect(response.headers.get('Content-Type')).toBe('text/html');
      expect(response.headers.get('X-Page')).toBe('busy');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Retry-After')).toBe('1');
      expect(await response.text()).toBe(method === 'HEAD' ? '' : '<h1>Busy</h1>');
    }

    expect(fixture.renderToStream).toHaveBeenCalledOnce();
    await first.text();
  });

  it('rejects before loaders run and frees the slot when a loader throws a response', async () => {
    const loader = vi.fn(() => ({ ok: true }));
    const fixture = handlerFixture({ admission: { maxConcurrency: 1 } }, [
      { path: '/', loader, Component: () => null },
    ]);
    const first = await fixture.fetch(documentRequest());
    const rejected = await fixture.fetch(documentRequest());

    expect(rejected.status).toBe(503);
    expect(loader).toHaveBeenCalledOnce();
    await first.text();
    expect((await fixture.fetch(documentRequest())).status).toBe(200);
  });

  it('keeps rendering and release functional when event hooks throw', async () => {
    const events: IAdmissionEvent[] = [];
    const fixture = handlerFixture({
      admission: {
        maxConcurrency: 1,
        onEvent: (event) => {
          events.push(event);
          throw new Error('metrics');
        },
      },
    });
    const first = await fixture.fetch(documentRequest());
    expect((await fixture.fetch(documentRequest())).status).toBe(503);
    await first.text();
    await (await fixture.fetch(documentRequest())).text();
    expect(events.map(({ outcome }) => outcome)).toEqual([
      'admitted',
      'rejected',
      'finish',
      'admitted',
      'finish',
    ]);
  });
});
