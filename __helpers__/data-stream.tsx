import React, { Suspense } from 'react';
import {
  Await,
  createStaticHandler,
  useActionData,
  useAsyncError,
  useLoaderData,
} from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import createHandler from '@core/handler';
import type { ICreateHandlerOptions } from '@core/handler';
import type { TRenderToStream } from '@core/render';

const ErrorElement = () => <p data-error>{(useAsyncError() as Error).message}</p>;
const Page = () => {
  const action = useActionData() as { slow: Promise<string> } | undefined;
  const loader = useLoaderData() as { slow: Promise<string> };
  const value = action ?? loader;
  return (
    <main>
      <button>Shell</button>
      <Suspense fallback={<p data-fallback>Loading</p>}>
        <Await resolve={value.slow} errorElement={<ErrorElement />}>
          {(text) => <p data-resolved>{text}</p>}
        </Await>
      </Suspense>
    </main>
  );
};
const fixture = (
  renderer: TRenderToStream,
  options: Partial<ICreateHandlerOptions<Record<string, any>>> = {},
  loader = () => ({
    slow: new Promise<string>((resolve) => setTimeout(() => resolve('Resolved users: 3'), 150)),
  }),
  Component = Page,
) =>
  createHandler(
    {
      createApp: (children) => children,
      handler: createStaticHandler([{ id: 'root', path: '*', Component, loader, action: loader }]),
      renderToStream: renderer,
    },
    {
      diagnostics: false,
      getHtml: () => ({
        header: '<!doctype html><html><body><div id="root">',
        footer: '</div></body></html>',
      }),
      ...options,
    },
  );
const chunks = async (response: Response) => {
  const result: { html: string; time: number }[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    result.push({ html: decoder.decode(chunk.value), time: performance.now() });
  }
  return result;
};

const testDataStream = (name: string, renderer: TRenderToStream): void => {
  describe(`real React loader/action streaming (${name})`, () => {
    it.each(['GET', 'POST'])(
      'streams fallback and settlements before footer initialization for %s',
      async (method) => {
        const start = performance.now();
        const parts = await chunks(
          await fixture(renderer, { getState: () => ({ custom: { ready: true } }) })(
            new Request('http://test/deferred', { method }),
          ),
        );
        const html = parts.map((part) => part.html).join('');
        expect(parts[0].html).not.toContain('SSRBPromise');
        expect(parts[0].html).not.toContain('window.__staticRouterHydrationData');
        expect(html.indexOf('SSRBPromise')).toBeGreaterThan(html.indexOf('<p data-resolved'));
        expect(html.indexOf('["resolve"')).toBeLessThan(html.indexOf('<p data-resolved'));
        expect(html).toContain('Resolved users: 3');
        expect(html.indexOf('data-fallback')).toBeLessThan(html.indexOf('["resolve"'));
        expect(html.indexOf('window.__staticRouterHydrationData')).toBeGreaterThan(
          html.indexOf('<p data-resolved'),
        );
        expect(html.indexOf('window.custom')).toBeGreaterThan(html.indexOf('<p data-resolved'));
        expect(html.indexOf('window.custom')).toBeLessThan(
          html.indexOf('window.__staticRouterHydrationData'),
        );
        expect(
          parts.find((part) => part.html.includes('["resolve"'))!.time - start,
        ).toBeGreaterThanOrEqual(130);
      },
    );

    it('streams rejection details and Await errorElement HTML', async () => {
      const handler = fixture(renderer, {}, () => ({
        slow: new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Deferred failed')), 40),
        ),
      }));
      const html = await (await handler(new Request('http://test/'))).text();
      expect(html).toContain('["reject"');
      expect(html).toContain('Deferred failed');
      expect(html).toContain('<p data-error');
      expect(html).not.toContain('data-resolved');
    });

    it('keeps two simultaneous request identities and results isolated', async () => {
      let count = 0;
      const handler = fixture(renderer, {}, () => {
        const id = ++count;
        return {
          slow: new Promise<string>((resolve) =>
            setTimeout(() => resolve(`request-${id}`), id === 1 ? 70 : 20),
          ),
        };
      });
      const [first, second] = await Promise.all([
        handler(new Request('http://test/one')).then((r) => r.text()),
        handler(new Request('http://test/two')).then((r) => r.text()),
      ]);
      expect(first).toContain('request-1');
      expect(first).not.toContain('request-2');
      expect(second).toContain('request-2');
      expect(second).not.toContain('request-1');
      expect(first).toContain('["resolve",0');
      expect(second).toContain('["resolve",0');
    });

    it('rejects pending promises before the timeout closes the response', async () => {
      const onError = vi.fn();
      const handler = fixture(renderer, { abortDelay: 40, onError }, () => ({
        slow: new Promise<string>(() => undefined),
      }));
      const html = await (await handler(new Request('http://test/'))).text();
      expect(html).toContain('["reject",0');
      expect(html).toContain('SSR loader/action promise aborted');
      expect(html.endsWith('</html>')).toBe(true);
      expect(onError).toHaveBeenCalled();
    });

    it('keeps the deadline for pending loader data that React never reads', async () => {
      const handler = fixture(
        renderer,
        { abortDelay: 40 },
        () => ({ slow: new Promise<string>(() => undefined) }),
        () => <p>no boundary</p>,
      );
      const html = await (await handler(new Request('http://test/'))).text();
      expect(html).toContain('["reject",0');
      expect(html).toContain('no boundary');
    });

    it('buffers bot rendering until both React and unconsumed data settle', async () => {
      const start = performance.now();
      const handler = fixture(renderer, { onRouterReady: () => ({ isStream: false }) });
      const response = await handler(
        new Request('http://test/', { headers: { 'User-Agent': 'Googlebot' } }),
      );
      expect(performance.now() - start).toBeGreaterThanOrEqual(130);
      const html = await response.text();
      expect(html).toContain('<p data-resolved');
      expect(html).toContain('Resolved users: 3');
      expect(html).not.toContain('<!--$?-->');
      expect(html.indexOf('["init"')).toBeGreaterThan(html.indexOf('<p data-resolved'));
      expect(html).toContain('["resolve",0');
    });

    it('emits custom state before early state and a shell marker before boundary chunks', async () => {
      const getState = vi.fn(() => ({ custom: { ready: true } }));
      const handler = fixture(renderer, { hydration: 'early', getState, nonce: 'test-nonce' });
      const parts = await chunks(await handler(new Request('http://test/')));
      const html = parts.map((part) => part.html).join('');
      expect(parts[0].html).toContain('window.custom');
      expect(parts[0].html).toContain('window.__staticRouterHydrationData');
      expect(parts[0].html).toContain('SSRBPromise');
      expect(html.indexOf('SSRBPromise')).toBeLessThan(html.indexOf('<main>'));
      expect(html.indexOf('["resolve"')).toBeLessThan(html.indexOf('<p data-resolved'));
      expect(html.indexOf('window.custom')).toBeLessThan(
        html.indexOf('window.__staticRouterHydrationData'),
      );
      expect(html.indexOf('<button>Shell')).toBeLessThan(html.indexOf('["shell"]'));
      expect(html.indexOf('["shell"]')).toBeLessThan(html.indexOf('<p data-resolved'));
      expect(getState).toHaveBeenCalledTimes(1);
      for (const [tag] of html.matchAll(/<script[^>]*>/g))
        expect(tag).toContain('nonce="test-nonce"');
    });

    it.skipIf(!React.use)('supports React 19 use with a native loader promise', async () => {
      const UsePage = () => {
        const { slow } = useLoaderData() as { slow: Promise<string> };
        const Content = () => <p data-use>{React.use(slow)}</p>;
        return (
          <Suspense fallback={<p>use fallback</p>}>
            <Content />
          </Suspense>
        );
      };
      const html = await (
        await fixture(renderer, {}, undefined, UsePage)(new Request('http://test/'))
      ).text();
      expect(html).toContain('<p data-use');
      expect(html).toContain('Resolved users: 3');
      expect(html).toContain('["resolve",0');
    });
  });
};

export default testDataStream;
