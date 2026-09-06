// @vitest-environment node
import { stringify } from 'devalue';
import { describe, expect, it } from 'vitest';
import DataStream from '@core/data-stream';
import { streamScript } from '@core/script';
import buildRouterState from '@helpers/build-router-state';
import { createDeferred, TestResponse } from '../../src/testing';

describe('TestResponse', () => {
  it('reads once, decodes split UTF-8 as it arrives and supports concurrent/repeated assertions', async () => {
    const next = createDeferred<void>();
    const bytes = new TextEncoder().encode('<p>🌍 café</p>');
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (index === 7) await next.promise;
        if (index === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(index, ++index));
      },
    });
    const response = new TestResponse(new Response(stream, { status: 201 }));
    const html = response.html();
    next.resolve();
    expect(response.status).toBe(201);
    expect(await html).toBe('<p>🌍 café</p>');
    expect(await response.text()).toBe(await html);
    const chunks = await response.chunks();
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(await html);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk, i) => chunk.at >= (chunks[i - 1]?.at ?? 0))).toBe(true);
    expect(await response.timeline()).toEqual([]);
  });

  it('parses legacy state and ignores scripts in text, comments and application JavaScript', async () => {
    const state = {
      loaderData: { root: { text: '</script>\u2028' } },
      actionData: null,
      errors: null,
    };
    const fake = streamScript(['init', 'invalid', false]);
    const response = new TestResponse(
      new Response(
        `<!--${fake}--><textarea>${fake}</textarea><script>throw new Error('must not execute')</script>${buildRouterState(state as never)}`,
      ),
    );
    expect(await response.routerState()).toEqual(state);
    expect(await response.streamFrames()).toEqual([]);
  });

  it('resolves nested and shared promises from out-of-init-order frames as native values', async () => {
    const first = createDeferred<unknown>();
    const nested = createDeferred<unknown>();
    const rich = {
      date: new Date('2025-01-01'),
      map: new Map([['key', new Set([1n, undefined])]]),
      regex: /hello/gi,
      nan: NaN,
      minusZero: -0,
      sparse: [, 'present'],
      own: Object.fromEntries([['__proto__', { safe: true }]]),
    };
    const stream = new DataStream({
      loaderData: { root: { first: first.promise, shared: first.promise } },
      actionData: null,
      errors: null,
    } as never);
    first.resolve({ rich, nested: nested.promise });
    nested.resolve(['ready', new Map([[2n, 'two']])]);
    await stream.done;
    const response = new TestResponse(new Response(`${stream.take()}${stream.state(false)}`));
    const state = await response.routerState();
    expect(state!.loaderData.root.first.rich).toEqual(rich);
    expect(state!.loaderData.root.first.nested).toEqual(['ready', new Map([[2n, 'two']])]);
    expect(state!.loaderData.root.first).toBe(state!.loaderData.root.shared);
    expect(state!.loaderData.root.first.rich.date).toBeInstanceOf(Date);
    expect(Object.hasOwn(state!.loaderData.root.first.rich.own, '__proto__')).toBe(true);
    expect((await response.streamFrames()).map((frame) => frame[0])).toEqual([
      'resolve',
      'resolve',
      'init',
    ]);
  });

  it('reports rejection and incomplete or duplicate frames without hanging', async () => {
    const deferred = createDeferred<void>();
    const stream = new DataStream({
      loaderData: { root: { deferred: deferred.promise } },
      actionData: null,
      errors: null,
    } as never);
    const initial = stream.state(true);
    await expect(new TestResponse(new Response(initial)).routerState()).rejects.toThrow(
      'Missing settlement',
    );
    deferred.reject(new TypeError('users failed'));
    await stream.done;
    const frames = stream.take();
    await expect(
      new TestResponse(new Response(initial + frames)).routerState(),
    ).rejects.toMatchObject({ name: 'TypeError', message: 'users failed' });
    await expect(
      new TestResponse(new Response(initial + initial)).routerState(),
    ).rejects.toThrow('exactly one');
    await expect(
      new TestResponse(new Response(initial + frames + frames)).routerState(),
    ).rejects.toThrow('Duplicate settlement');
    await expect(
      new TestResponse(new Response(streamScript(['resolve', 'bad', 'bad']))).streamFrames(),
    ).rejects.toThrow('Invalid');
    await expect(
      new TestResponse(
        new Response(streamScript(['init', stringify({}), false])),
      ).routerState(),
    ).resolves.toEqual({});
  });

  it('counts raw pending markers and parses separate cookies, Expires, flags and equals signs', async () => {
    const headers = new Headers();
    headers.append('Set-Cookie', 'session=a=b; Path=/; HttpOnly; Secure; SameSite=Lax');
    headers.append(
      'Set-Cookie',
      'session=other; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/other',
    );
    const response = new TestResponse(new Response('<!--$?--><!--$?-->', { headers }));
    expect(await response.pendingBoundaries()).toBe(2);
    expect(response.cookies()).toEqual([
      {
        name: 'session',
        value: 'a=b',
        attributes: { path: '/', httponly: true, secure: true, samesite: 'Lax' },
      },
      {
        name: 'session',
        value: 'other',
        attributes: { expires: 'Wed, 21 Oct 2037 07:28:00 GMT', path: '/other' },
      },
    ]);
    Object.defineProperty(headers, 'getSetCookie', { value: undefined });
    Object.defineProperty(response.response, 'headers', { value: headers });
    expect(response.cookies()).toHaveLength(2);
  });

  it('handles bodyless responses and preserves stream failures across accessors', async () => {
    const empty = new TestResponse(
      new Response(null, { status: 302, headers: { Location: '/login' } }),
    );
    expect(await empty.html()).toBe('');
    expect(await empty.routerState()).toBeUndefined();
    expect(empty.headers.get('Location')).toBe('/login');
    const failed = new TestResponse(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('broken transport'));
          },
        }),
      ),
    );
    await expect(failed.html()).rejects.toThrow('broken transport');
    await expect(failed.chunks()).rejects.toThrow('broken transport');
    expect(await failed.timeline()).toEqual([]);
  });
});
