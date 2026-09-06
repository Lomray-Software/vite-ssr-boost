// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../__fixtures__/caching/express';
import { bufferedPage } from '../../__fixtures__/caching/buffered';
import { createGuestCache } from '../../__fixtures__/caching/guest-cache';
import { onShellReady } from '../../__fixtures__/caching/manual';
import { guestPolicy } from '../../__fixtures__/caching/policy';

describe('compiled caching recipes', () => {
  let server: http.Server;
  let origin: string;
  beforeAll(async () => {
    server = http.createServer(app).listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves the Express guest and authenticated documents', async () => {
    for (const [headers, policy, content] of [
      [{}, guestPolicy, 'Guest page'],
      [{ Cookie: 'session=' }, 'private, no-store', 'Account page'],
      [{ Authorization: 'Bearer credential' }, 'private, no-store', 'Account page'],
    ] as const) {
      const response = await fetch(`${origin}/guest`, { headers });
      expect(response.headers.get('Cache-Control')).toBe(policy);
      expect(await response.text()).toContain(content);
    }
  });

  it('executes the manual hook and buffered conditional response recipes', async () => {
    const context = {
      request: new Request('https://example.test/guest', { headers: { Cookie: 'session=x' } }),
      response: { headers: new Headers() },
    };
    onShellReady!({ context: context as never });
    expect(context.response.headers.get('Cache-Control')).toBe('private, no-store');
    const page = bufferedPage(new Request('https://example.test/'));
    expect(await page.text()).toContain('revision 7');
    for (const method of ['GET', 'HEAD']) {
      const unchanged = bufferedPage(
        new Request('https://example.test/', {
          method,
          headers: { 'If-None-Match': page.headers.get('ETag')! },
        }),
      );
      expect(unchanged.status).toBe(304);
      expect(unchanged.headers.get('Cache-Control')).toBe(page.headers.get('Cache-Control'));
      expect(await unchanged.text()).toBe('');
    }
    expect(
      await bufferedPage(new Request('https://example.test/', { method: 'HEAD' })).text(),
    ).toBe('');
  });

  const nginx = process.env.NGINX_BINARY ?? 'nginx';
  it.skipIf(spawnSync(nginx, ['-v']).error)(
    'runs the Nginx configuration against Express, including empty/zero session bypass',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'caching-nginx-'));
      const probe = http.createServer().listen(0, '127.0.0.1');
      await once(probe, 'listening');
      const port = (probe.address() as AddressInfo).port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const config = (
        await readFile(new URL('../../__fixtures__/caching/nginx.conf', import.meta.url), 'utf8')
      )
        .replace('listen 8080;', `listen 127.0.0.1:${port};`)
        .replaceAll('http://127.0.0.1:3000', origin);
      await writeFile(join(directory, 'nginx.conf'), config);
      const args = ['-p', `${directory}/`, '-c', 'nginx.conf', '-e', 'stderr'];
      const checked = spawnSync(nginx, [...args, '-t'], { encoding: 'utf8' });
      expect(checked.status, checked.stderr).toBe(0);
      const child = spawn(nginx, [...args, '-g', 'daemon off; master_process off;'], {
        stdio: 'pipe',
      });
      const closed = once(child, 'exit');
      try {
        const url = `http://127.0.0.1:${port}/guest`;
        await vi.waitFor(async () => {
          await (await fetch(url)).text();
        });
        const guest = await fetch(url);
        expect(guest.headers.get('X-Page-Cache')).toBe('HIT');
        expect(await guest.text()).toContain('Guest page');
        const credentialHeaders: HeadersInit[] = [
          { Cookie: 'session=secret' },
          { Cookie: 'session=' },
          { Cookie: 'session=0' },
          { Authorization: 'Bearer secret' },
        ];
        for (const headers of credentialHeaders) {
          const account = await fetch(url, { headers });
          expect(account.headers.get('X-Page-Cache'), JSON.stringify(headers)).toBe('BYPASS');
          expect(account.headers.get('Cache-Control')).toBe('private, no-store');
          expect(await account.text()).toContain('Account page');
        }
        const after = await fetch(url);
        expect(after.headers.get('X-Page-Cache')).toBe('HIT');
        expect(await after.text()).toContain('Guest page');
      } finally {
        child.kill('SIGTERM');
        await closed;
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

describe('Worker Cache API recipe', () => {
  const setup = () => {
    const stored = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (request: Request) => stored.get(request.url)?.clone()),
      put: vi.fn(async (request: Request, response: Response) => {
        stored.set(request.url, new Response(await response.arrayBuffer(), response));
      }),
      delete: vi.fn(async (request: Request) => stored.delete(request.url)),
    };
    let time = 1_000_000;
    const origin = vi.fn(
      async () =>
        new Response(`revision ${origin.mock.calls.length}`, {
          headers: { 'Cache-Control': guestPolicy },
        }),
    );
    const background: Promise<unknown>[] = [];
    const context = {
      waitUntil: (promise: Promise<unknown>) => {
        background.push(promise);
      },
    };
    const handler = createGuestCache(origin, cache as never, () => time);
    return {
      cache,
      origin,
      background,
      context,
      handler,
      advance: (seconds: number) => {
        time += seconds * 1000;
      },
    };
  };

  it('caches by full URL, strips unkeyed inputs, refreshes stale content and expires the window', async () => {
    const { handler, context, origin, background, advance } = setup();
    const request = new Request('https://example.test/guest?language=en', {
      headers: { Cookie: 'theme=dark', 'X-Unkeyed': 'value' },
    });
    expect(await (await handler(request, context)).text()).toBe('revision 1');
    const forwarded = origin.mock.calls[0] as unknown as [Request];
    expect(forwarded[0].headers.has('Cookie')).toBe(false);
    expect(forwarded[0].headers.has('X-Unkeyed')).toBe(false);
    advance(20);
    const fresh = await handler(request, context);
    expect(await fresh.text()).toBe('revision 1');
    expect(fresh.headers.get('Age')).toBe('20');
    expect(fresh.headers.has('X-Guest-Cache-Stored-At')).toBe(false);
    expect(origin).toHaveBeenCalledTimes(1);
    advance(15);
    expect(await (await handler(request, context)).text()).toBe('revision 1');
    await Promise.all(background);
    expect(await (await handler(request, context)).text()).toBe('revision 2');
    advance(91);
    expect(await (await handler(request, context)).text()).toBe('revision 3');
    expect(
      await (await handler(new Request('https://example.test/guest?language=fr'), context)).text(),
    ).toBe('revision 4');
  });

  it.each([
    { headers: { Cookie: 'session=' } },
    { headers: { Cookie: 'session=0' } },
    { headers: { Authorization: '' } },
    { headers: { Range: 'bytes=0-10' } },
    { headers: { 'If-None-Match': '"v1"' } },
    { headers: { 'Cache-Control': 'no-cache' } },
    { method: 'HEAD' },
    { method: 'POST' },
  ])('bypasses both reads and writes for %j', async (init) => {
    const { handler, context, cache, origin } = setup();
    const request = new Request('https://example.test/guest', init as RequestInit);
    await (await handler(request, context)).text();
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(origin).toHaveBeenCalledWith(request);
  });

  it.each([
    { status: 500 },
    { headers: { 'Cache-Control': 'private, no-store' } },
    { headers: { 'Cache-Control': guestPolicy, 'Set-Cookie': 'session=x' } },
    { headers: { 'Cache-Control': guestPolicy, Vary: 'Accept-Language' } },
  ])('does not store unsafe origin responses %j', async (init) => {
    const { handler, context, cache, origin } = setup();
    origin.mockResolvedValueOnce(new Response('uncacheable', init as ResponseInit));
    await (await handler(new Request('https://example.test/guest'), context)).text();
    expect(cache.put).not.toHaveBeenCalled();
    expect(cache.delete).toHaveBeenCalled();
  });

  it('keeps refresh failure within the stale window and then surfaces origin errors', async () => {
    const { handler, context, origin, background, advance } = setup();
    const request = new Request('https://example.test/guest');
    await (await handler(request, context)).text();
    advance(31);
    origin.mockRejectedValue(new Error('origin unavailable'));
    expect(await (await handler(request, context)).text()).toBe('revision 1');
    await Promise.all(background);
    advance(60);
    await expect(handler(request, context)).rejects.toThrow('origin unavailable');
  });
});
