import React, { Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { Await, redirect, useLoaderData } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ISsrRequestContext } from '@core/render';
import createDeferred from '../src/testing/deferred';
import { browserRequest, crawlerRequest } from '../src/testing/requests';
import type { createTestHandler as create } from '../src/testing';

const DeferredPage = () => {
  const { users } = useLoaderData() as { users: Promise<string[]> };
  return (
    <main>
      <h1>Users</h1>
      <Suspense fallback={<p>Loading users</p>}>
        <Await resolve={users} errorElement={<p>Failed users</p>}>
          {(value) => <p data-users>{value.join(', ')}</p>}
        </Await>
      </Suspense>
    </main>
  );
};

/** Run the same public contract in separate files for React's two server renderers. */
const testKit = (name: string, createTestHandler: typeof create): void => {
  const fixture = (users = createDeferred<string[]>()) => {
    const routes: RouteObject[] = [
      {
        id: 'home',
        path: '/',
        loader: () => ({ greeting: 'Hello SSR' }),
        Component: () => <p>Hello SSR</p>,
      },
      {
        id: 'users',
        path: '/deferred',
        loader: () => ({ users: users.promise }),
        Component: DeferredPage,
      },
      { path: '/redirect', loader: () => redirect('/') },
      {
        path: '/cookie',
        loader: ({ context }) => {
          (context as unknown as ISsrRequestContext).response.headers.append(
            'Set-Cookie',
            'session=test; Path=/; HttpOnly',
          );
          return null;
        },
        Component: () => <p>Cookie set</p>,
      },
      {
        path: '*',
        loader: () => {
          throw new Response('Not found', { status: 404 });
        },
        ErrorBoundary: () => <p>Not found</p>,
      },
    ];
    return { routes, users };
  };

  describe(`testing kit (${name})`, () => {
    it('renders normal routes with App props, the default shell, redirects, 404s and cookies', async () => {
      const { routes } = fixture();
      const app = createTestHandler({
        routes,
        diagnostics: true,
        App: ({ children, server }) => <article lang={server.locale}>{children}</article>,
        onRequest: () => ({ appProps: { locale: 'en' } }),
      });
      const response = await app.fetch('/');
      expect(response.status).toBe(200);
      expect(await response.html()).toContain('<article lang="en"><p>Hello SSR</p>');
      expect(await response.html()).toContain('<script type="module">');
      expect(await response.routerState()).toMatchObject({
        loaderData: { home: { greeting: 'Hello SSR' } },
      });
      const redirectResponse = await app.fetch('/redirect');
      expect(redirectResponse.status).toBe(302);
      expect(redirectResponse.headers.get('Location')).toBe('/');
      expect((await redirectResponse.timeline()).map((event) => event.stage)).toEqual([
        'router.query',
        'response.end',
      ]);
      const missing = await app.fetch('/missing');
      expect(missing.status).toBe(404);
      expect(await missing.html()).toContain('Not found');
      expect((await app.fetch('/cookie')).cookies()).toEqual([
        { name: 'session', value: 'test', attributes: { path: '/', httponly: true } },
      ]);
    });

    it.each(['footer', 'early'] as const)(
      'releases deferred data after the shell with %s hydration and records emission order',
      async (hydration) => {
        const { routes, users } = fixture();
        const shell = createDeferred<void>();
        const app = createTestHandler({
          routes,
          hydration,
          diagnostics: true,
          onResponse: ({ html }) => {
            if (html.includes('Loading users')) shell.resolve();
          },
        });
        const response = await app.fetch(browserRequest('/deferred'));
        await shell.promise;
        users.resolve(['Ada', 'Grace']);
        expect(await response.routerState()).toMatchObject({
          loaderData: { users: { users: ['Ada', 'Grace'] } },
        });
        const chunks = await response.chunks();
        const loading = chunks.findIndex((chunk) => chunk.text.includes('Loading users'));
        const resolved = chunks.findIndex((chunk) => chunk.text.includes('["resolve"'));
        expect(resolved).toBeGreaterThan(loading);
        expect(chunks[resolved].at).toBeGreaterThanOrEqual(chunks[loading].at);
        const frames = await response.streamFrames();
        expect(frames).toContainEqual(expect.arrayContaining(['resolve', 0]));
        expect(frames.find((frame) => frame[0] === 'init')?.[2]).toBe(hydration === 'early');
        const events = await response.timeline();
        const stages = events.map((event) => event.stage);
        expect(stages.slice(0, 3)).toEqual(['router.query', 'prepare', 'shell.ready']);
        expect(stages.at(-1)).toBe('response.end');
        expect(events.find((event) => event.stage === 'stream.resolve')).toMatchObject({
          id: 0,
        });
        expect(events.find((event) => event.stage === 'state.emitted')).toMatchObject({
          placement: hydration,
        });
        expect(stages.indexOf('state.emitted') < stages.indexOf('body.end')).toBe(
          hydration === 'early',
        );
        expect(events.every((event, i) => event.at >= (events[i - 1]?.at ?? 0))).toBe(true);
      },
    );

    it('passes bot detection through to the app and allows a request streaming override', async () => {
      const { routes, users } = fixture();
      const ready = createDeferred<void>();
      const onRouterReady = vi.fn(({ context }: { context: ISsrRequestContext }) => {
        ready.resolve();
        return { isStream: !context.request.headers.get('user-agent')?.includes('Googlebot') };
      });
      const app = createTestHandler({ routes, hydration: 'early', onRouterReady });
      const pending = app.fetch(crawlerRequest('/deferred'));
      let returned = false;
      void pending.then(() => {
        returned = true;
      });
      await ready.promise;
      expect(returned).toBe(false);
      users.resolve(['Crawler users']);
      const response = await pending;
      expect(await response.pendingBoundaries()).toBe(0);
      expect(await response.html()).toContain('Crawler users');
      expect((await response.streamFrames()).find((frame) => frame[0] === 'init')?.[2]).toBe(
        false,
      );
      const next = fixture();
      const streaming = createTestHandler({ routes: next.routes, onRouterReady });
      const streamResponse = await streaming.fetch(crawlerRequest('/deferred'), {
        isStream: true,
      });
      next.users.resolve(['override']);
      expect(await streamResponse.html()).toContain('override');
      expect(onRouterReady).toHaveBeenCalledTimes(2);
    });

    it('returns deferred rejection frames on the render deadline', async () => {
      const { routes } = fixture();
      const app = createTestHandler({ routes, abortDelay: 30, diagnostics: true });
      const response = await app.fetch('/deferred');
      expect(await response.html()).toContain('SSR loader/action promise aborted');
      const events = await response.timeline();
      expect(events).toContainEqual(
        expect.objectContaining({ stage: 'abort', reason: 'SSR render timed out after 30ms' }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({ stage: 'stream.reject', id: 0 }),
      );
      expect(events.at(-1)?.stage).toBe('response.end');
    });

    it('cancels during query and after the shell; whole-request deadlines include loaders', async () => {
      const slow = createDeferred<void>();
      const query = createTestHandler({
        routes: [{ path: '/', loader: () => slow.promise }],
        timeout: 20,
      });
      await expect(query.fetch('/')).rejects.toMatchObject({ name: 'TimeoutError' });
      slow.resolve();
      const { routes } = fixture();
      const controller = new AbortController();
      const response = await createTestHandler({ routes, diagnostics: true }).fetch(
        '/deferred',
        { signal: controller.signal },
      );
      controller.abort(new Error('test disconnected'));
      await expect(response.html()).rejects.toThrow('test disconnected');
      const events = await response.timeline();
      expect(events.filter((event) => event.stage === 'abort')).toHaveLength(1);
      expect(events).toContainEqual(expect.objectContaining({ reason: 'test disconnected' }));
      expect(events.at(-1)?.stage).toBe('response.end');
      await expect(
        createTestHandler({ routes, signal: controller.signal }).fetch('/'),
      ).rejects.toThrow('test disconnected');
    });

    it('keeps concurrent contexts and timelines independent and allocates none when disabled', async () => {
      vi.stubEnv('SSR_BOOST_TIMELINE', '');
      vi.stubEnv('SSR_BOOST_DIAGNOSTICS', '0');
      const { routes } = fixture();
      const onContext = vi.fn();
      try {
        const response = await createTestHandler({
          routes,
          diagnostics: false,
          onContext,
        }).fetch('/');
        expect(await response.timeline()).toEqual([]);
        expect(Object.hasOwn(onContext.mock.calls[0][0].context, 'timeline')).toBe(false);
      } finally {
        vi.unstubAllEnvs();
      }
      const contexts: ISsrRequestContext[] = [];
      const app = createTestHandler({
        routes,
        diagnostics: true,
        onContext: ({ context }) => contexts.push(context),
      });
      const responses = await Promise.all([app.fetch('/'), app.fetch('/cookie')]);
      await Promise.all(responses.map((response) => response.html()));
      expect(contexts[0].timeline).not.toBe(contexts[1].timeline);
      expect(contexts[0].timeline!.events).not.toBe(contexts[1].timeline!.events);
    });
  });
};

export default testKit;
