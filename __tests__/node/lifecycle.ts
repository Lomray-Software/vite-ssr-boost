// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import createLifecycle, { trackNativeBind } from '@node/lifecycle';
import type { ILifecycle } from '@node/lifecycle';

const servers: http.Server[] = [];

/**
 * Start a server whose handler is supplied by the test.
 */
const listen = async (
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  configure?: (server: http.Server) => ILifecycle,
): Promise<{ server: http.Server; lifecycle: ILifecycle; url: string }> => {
  const server = http.createServer();
  const lifecycle = configure?.(server) ?? createLifecycle(server);

  server.on('request', handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    server,
    lifecycle,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
};

/**
 * Collect a streamed response body over a real socket.
 */
const getText = (url: string, agent?: http.Agent): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    http
      .get(url, { agent }, (res) => {
        let body = '';

        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode!, body }));
        res.on('error', reject);
      })
      .on('error', reject);
  });

/**
 * Open a raw socket and complete an HTTP upgrade handshake on it.
 */
const upgrade = (server: http.Server): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = net.connect((server.address() as AddressInfo).port, '127.0.0.1');

    socket.once('error', reject);
    socket.once('data', () => resolve(socket));
    socket.write('GET /hmr HTTP/1.1\r\nHost: test\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n');
  });

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe('createLifecycle', () => {
  it('keeps Node timeouts unless set and applies the proxy profile when given', () => {
    const defaults = http.createServer();
    const { keepAliveTimeout, headersTimeout, requestTimeout } = defaults;

    createLifecycle(defaults);
    expect([defaults.keepAliveTimeout, defaults.headersTimeout, defaults.requestTimeout]).toEqual([
      keepAliveTimeout,
      headersTimeout,
      requestTimeout,
    ]);

    const tuned = http.createServer();

    createLifecycle(tuned, {
      keepAliveTimeoutMs: 65000,
      headersTimeoutMs: 66000,
      requestTimeoutMs: 300000,
    });
    expect([tuned.keepAliveTimeout, tuned.headersTimeout, tuned.requestTimeout]).toEqual([
      65000, 66000, 300000,
    ]);
  });

  it('answers health probes only when enabled and reports ready until draining', async () => {
    let lifecycle!: ILifecycle;
    const { url } = await listen(
      (req, res) => lifecycle.health(req, res, () => res.end('app')),
      (server) => {
        lifecycle = createLifecycle(server, { health: { readyPath: '/ready' } });

        return lifecycle;
      },
    );

    expect(await getText(`${url}/healthz`)).toEqual({ status: 200, body: 'ok' });
    expect(await getText(`${url}/ready`)).toEqual({ status: 503, body: 'unavailable' });
    lifecycle.setReady();
    expect(lifecycle.isReady()).toBe(true);
    expect(await getText(`${url}/ready?probe=1`)).toEqual({ status: 200, body: 'ok' });
    expect(await getText(`${url}/readyz`)).toEqual({ status: 200, body: 'app' });
  });

  it('passes every request through when health is not configured', async () => {
    let lifecycle!: ILifecycle;
    const { url } = await listen(
      (req, res) => lifecycle.health(req, res, () => res.end('app')),
      (server) => {
        lifecycle = createLifecycle(server);

        return lifecycle;
      },
    );

    expect(await getText(`${url}/healthz`)).toEqual({ status: 200, body: 'app' });
  });

  it('rejects non-GET probe methods', async () => {
    let lifecycle!: ILifecycle;
    const { url } = await listen(
      (req, res) => lifecycle.health(req, res, () => res.end('app')),
      (server) => {
        lifecycle = createLifecycle(server, { health: true });

        return lifecycle;
      },
    );
    const response = await fetch(`${url}/healthz`, { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('lets an active stream finish, refuses new connections and closes idle keep-alive', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onClose = vi.fn();
    let lifecycle!: ILifecycle;
    const { server, url } = await listen(
      (req, res) => {
        if (req.url === '/stream') {
          res.write('first;');
          void held.then(() => res.end('last'));

          return;
        }

        lifecycle.health(req, res, () => res.end('quick'));
      },
      (instance) => {
        lifecycle = createLifecycle(instance, { health: true, onClose });

        return lifecycle;
      },
    );
    const agent = new http.Agent({ keepAlive: true });

    lifecycle.setReady();
    expect(await getText(`${url}/quick`, agent)).toEqual({ status: 200, body: 'quick' });

    const streamed = getText(`${url}/stream`);

    await vi.waitFor(() => expect(server.listening).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const first = lifecycle.close();
    const second = lifecycle.close();

    expect(first).toBe(second);
    expect(lifecycle.isDraining()).toBe(true);
    expect(lifecycle.isReady()).toBe(false);
    await expect(getText(`${url}/quick`)).rejects.toThrow();
    release();
    expect(await streamed).toEqual({ status: 200, body: 'first;last' });
    await first;
    expect(onClose).toHaveBeenCalledOnce();
    agent.destroy();
  });

  it('destroys streams still open at the drain timeout', async () => {
    let lifecycle!: ILifecycle;
    const { url } = await listen(
      (_req, res) => {
        res.write('stuck');
      },
      (server) => {
        lifecycle = createLifecycle(server, { drainTimeoutMs: 50 });

        return lifecycle;
      },
    );
    const streamed = getText(url);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const startedAt = Date.now();

    await lifecycle.close();
    expect(Date.now() - startedAt).toBeLessThan(1000);
    await expect(streamed).rejects.toThrow();
  });

  it('resolves close for a server that never listened', async () => {
    const onClose = vi.fn();
    const lifecycle = createLifecycle(http.createServer(), { onClose });

    await lifecycle.close();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('joins a native close already in progress and waits for its streams', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onClose = vi.fn();
    const { url, lifecycle } = await listen(
      (_req, res) => {
        res.write('first;');
        void held.then(() => res.end('last'));
      },
      (server) => createLifecycle(server, { onDrain: () => void server.close(), onClose }),
    );
    const streamed = getText(url);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const closed = lifecycle.close();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onClose).not.toHaveBeenCalled();
    release();
    expect(await streamed).toEqual({ status: 200, body: 'first;last' });
    await closed;
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('destroys a stream held by a native close at the drain deadline', async () => {
    const onClose = vi.fn();
    const { url, lifecycle } = await listen(
      (_req, res) => {
        res.write('stuck');
      },
      (server) =>
        createLifecycle(server, {
          drainTimeoutMs: 50,
          onDrain: () => void server.close(),
          onClose,
        }),
    );
    const streamed = getText(url);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const startedAt = Date.now();

    await lifecycle.close();
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(onClose).toHaveBeenCalledOnce();
    await expect(streamed).rejects.toThrow();
  });

  it('drains on SIGTERM, forces on a second signal and unsubscribes', async () => {
    const listeners = new Map<string, () => void>();

    vi.spyOn(process, 'on').mockImplementation(((signal: string, listener: () => void) => {
      listeners.set(signal, listener);

      return process;
    }) as typeof process.on);
    vi.spyOn(process, 'off').mockImplementation(((signal: string) => {
      listeners.delete(signal);

      return process;
    }) as typeof process.off);

    let lifecycle!: ILifecycle;
    const { server, url } = await listen(
      (_req, res) => {
        res.write('open');
      },
      (instance) => {
        lifecycle = createLifecycle(instance);

        return lifecycle;
      },
    );
    const onExit = vi.fn();
    const unsubscribe = lifecycle.handleSignals({ onExit });
    const streamed = getText(url).catch((error: Error) => error);

    expect([...listeners.keys()]).toEqual(['SIGTERM', 'SIGINT']);
    await new Promise((resolve) => setTimeout(resolve, 20));
    listeners.get('SIGTERM')!();
    expect(lifecycle.isDraining()).toBe(true);

    const closeAll = vi.spyOn(server, 'closeAllConnections');

    listeners.get('SIGINT')!();
    expect(closeAll).toHaveBeenCalled();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(0));
    expect(await streamed).toBeInstanceOf(Error);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });

  it('destroys upgraded sockets so close resolves while a WebSocket client is connected', async () => {
    let lifecycle!: ILifecycle;
    const { server } = await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance);

        return lifecycle;
      },
    );

    server.on('upgrade', (_req, socket: Socket) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n',
      );
    });

    const client = await upgrade(server);
    const clientClosed = new Promise((resolve) => client.once('close', resolve));

    await lifecycle.close();
    await clientClosed;
    expect(server.listening).toBe(false);
  });

  it('keeps upgraded sockets while a response streams and drops them when it ends', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lifecycle!: ILifecycle;
    const { server, url } = await listen(
      (_req, res) => {
        res.write('first;');
        void held.then(() => res.end('last'));
      },
      (instance) => {
        lifecycle = createLifecycle(instance);

        return lifecycle;
      },
    );

    server.on('upgrade', (_req, socket: Socket) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n',
      );
    });

    const client = await upgrade(server);
    const streamed = getText(url);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const closed = lifecycle.close();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.destroyed).toBe(false);
    release();
    expect(await streamed).toEqual({ status: 200, body: 'first;last' });
    await closed;
    await vi.waitFor(() => expect(client.destroyed).toBe(true));
  });

  it('destroys upgraded sockets at the drain timeout together with stuck streams', async () => {
    let lifecycle!: ILifecycle;
    const { server, url } = await listen(
      (_req, res) => {
        res.write('stuck');
      },
      (instance) => {
        lifecycle = createLifecycle(instance, { drainTimeoutMs: 50 });

        return lifecycle;
      },
    );

    server.on('upgrade', (_req, socket: Socket) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n',
      );
    });

    const client = await upgrade(server);
    const streamed = getText(url).catch((error: Error) => error);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await lifecycle.close();
    expect(await streamed).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(client.destroyed).toBe(true));
  });

  it('attaches the upgrade tracker only while the application listens for upgrades', () => {
    const server = http.createServer();

    createLifecycle(server);
    expect(server.listenerCount('upgrade')).toBe(0);

    /**
     * Application upgrade handler.
     */
    const onUpgrade = (): void => undefined;

    server.on('upgrade', onUpgrade);
    expect(server.listenerCount('upgrade')).toBe(2);
    expect(server.listeners('upgrade')[1]).toBe(onUpgrade);
    server.off('upgrade', onUpgrade);
    expect(server.listenerCount('upgrade')).toBe(0);

    const prepared = http.createServer();

    prepared.on('upgrade', onUpgrade);
    createLifecycle(prepared);
    expect(prepared.listenerCount('upgrade')).toBe(2);
  });

  it('runs onDrain while the drain starts and onClose after the server stopped', async () => {
    const calls: string[] = [];
    let lifecycle!: ILifecycle;
    const { server } = await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance, {
          onDrain: () => {
            calls.push(`drain:${String(instance.listening)}`);
          },
          onClose: () => {
            calls.push(`close:${String(instance.listening)}`);
          },
        });

        return lifecycle;
      },
    );

    await lifecycle.close();
    expect(calls).toEqual(['drain:true', 'close:false']);
    expect(server.listening).toBe(false);
  });

  it('still stops the server and rejects when onDrain fails', async () => {
    const onClose = vi.fn();
    let lifecycle!: ILifecycle;
    const { server } = await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance, {
          onDrain: () => Promise.reject(new Error('vite close failed')),
          onClose,
        });

        return lifecycle;
      },
    );

    await expect(lifecycle.close()).rejects.toThrow('vite close failed');
    expect(server.listening).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('rejects close when onDrain stalls past its phase deadline and still runs onClose', async () => {
    const onClose = vi.fn();
    let lifecycle!: ILifecycle;
    const { server } = await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance, {
          drainTimeoutMs: 50,
          onDrain: () => new Promise<void>(() => undefined),
          onClose,
        });

        return lifecycle;
      },
    );

    await expect(lifecycle.close()).rejects.toThrow(
      '[ssr-boost] onDrain did not settle within 50 ms.',
    );
    expect(server.listening).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('rejects close when onClose stalls past its own deadline', async () => {
    let lifecycle!: ILifecycle;
    const { server } = await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance, {
          drainTimeoutMs: 50,
          onClose: () => new Promise<void>(() => undefined),
        });

        return lifecycle;
      },
    );

    await expect(lifecycle.close()).rejects.toThrow(
      '[ssr-boost] onClose did not settle within 50 ms.',
    );
    expect(server.listening).toBe(false);
  });

  it('ends a stalled drain at once on force', async () => {
    let lifecycle!: ILifecycle;

    await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance, {
          onDrain: () => new Promise<void>(() => undefined),
        });

        return lifecycle;
      },
    );

    const closed = lifecycle.close();

    lifecycle.force();
    await expect(closed).rejects.toThrow('[ssr-boost] onDrain did not settle within 30000 ms.');
  });

  it('destroys CONNECT tunnels so close resolves', async () => {
    let lifecycle!: ILifecycle;
    const { server } = await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance);

        return lifecycle;
      },
    );

    server.on('connect', (_req, socket: Socket) => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    });

    const client = await new Promise<Socket>((resolve, reject) => {
      const socket = net.connect((server.address() as AddressInfo).port, '127.0.0.1');

      socket.once('error', reject);
      socket.once('data', () => resolve(socket));
      socket.write('CONNECT upstream:443 HTTP/1.1\r\nHost: upstream:443\r\n\r\n');
    });
    const clientClosed = new Promise((resolve) => client.once('close', resolve));

    await lifecycle.close();
    await clientClosed;
    expect(server.listening).toBe(false);
  });

  it('refuses listen after close and lets close wait for a bind in flight', async () => {
    const early = http.createServer();
    const earlyLifecycle = createLifecycle(early);

    servers.push(early);
    await earlyLifecycle.close();
    await expect(earlyLifecycle.listen(0, '127.0.0.1')).rejects.toThrow(
      '[ssr-boost] listen() was called after close() started.',
    );
    expect(early.listening).toBe(false);

    const late = http.createServer();
    const lateLifecycle = createLifecycle(late);

    servers.push(late);

    const bound = lateLifecycle.listen(0, '127.0.0.1');

    await lateLifecycle.close();
    await expect(bound).resolves.toMatchObject({ address: '127.0.0.1' });
    expect(late.listening).toBe(false);
    expect(late.listenerCount('error')).toBe(0);
  });

  it('drops its error listener when listen throws and refuses a second bind in flight', async () => {
    const server = http.createServer();
    const lifecycle = createLifecycle(server);

    servers.push(server);
    await expect(lifecycle.listen(-1)).rejects.toMatchObject({ code: 'ERR_SOCKET_BAD_PORT' });
    expect(server.listenerCount('error')).toBe(0);

    const bound = lifecycle.listen(0, 'localhost');

    await expect(lifecycle.listen(0, 'localhost')).rejects.toThrow(
      '[ssr-boost] listen() was called while a bind is in flight.',
    );
    await expect(bound).resolves.toBeTruthy();
    expect(server.listenerCount('error')).toBe(0);
  });

  it('bounds a pending native bind by the drain deadline and releases a bind that lands later', async () => {
    const server = http.createServer();
    const lifecycle = createLifecycle(server, { drainTimeoutMs: 50 });

    servers.push(server);
    trackNativeBind(lifecycle);
    await expect(lifecycle.close()).resolves.toBeUndefined();

    const released = new Promise<void>((resolve) => server.once('close', () => resolve()));

    server.listen(0, '127.0.0.1');
    await released;
    expect(server.listening).toBe(false);
  });

  it('ends a pending native bind that a native close cancelled', async () => {
    const server = http.createServer();
    const lifecycle = createLifecycle(server, { drainTimeoutMs: 60_000 });

    servers.push(server);
    trackNativeBind(lifecycle);
    // A close() during the host lookup cancels the bind with only a `close` event.
    server.listen(0, 'localhost');
    server.close();

    const startedAt = Date.now();

    await expect(lifecycle.close()).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('rejects a managed listen that a native close cancelled', async () => {
    const server = http.createServer();
    const lifecycle = createLifecycle(server, { drainTimeoutMs: 60_000 });

    servers.push(server);

    const counts = (): number[] =>
      ['listening', 'error', 'close'].map((event) => server.listenerCount(event));
    const before = counts();
    // A close() during the host lookup cancels the bind with only a `close` event.
    const bound = lifecycle.listen(0, 'localhost');

    server.close();
    await expect(bound).rejects.toThrow('cancelled by close()');
    expect(counts()).toEqual(before);
    // The cancelled lookup must not bind once it resolves.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.listening).toBe(false);

    const startedAt = Date.now();

    await expect(lifecycle.close()).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('lets a new managed listen start once a cancelled one ended', async () => {
    const server = http.createServer();
    const lifecycle = createLifecycle(server);

    servers.push(server);

    const bound = lifecycle.listen(0, 'localhost');

    server.close();
    await expect(bound).rejects.toThrow('cancelled by close()');
    await expect(lifecycle.listen(0, '127.0.0.1')).resolves.toMatchObject({
      port: expect.any(Number),
    });
  });

  it('lets force end a pending native bind at once', async () => {
    const server = http.createServer();
    const lifecycle = createLifecycle(server);

    servers.push(server);
    trackNativeBind(lifecycle);

    const closed = lifecycle.close();

    lifecycle.force();
    await expect(closed).resolves.toBeUndefined();

    const released = new Promise<void>((resolve) => server.once('close', () => resolve()));

    server.listen(0, '127.0.0.1');
    await released;
    expect(server.listening).toBe(false);
  });

  it('keeps the drain deadline alive on an otherwise idle process', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/node/lifecycle.ts', import.meta.url)),
      'utf8',
    );
    const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
    const script = `${code}
const lifecycle = createLifecycle((await import('node:http')).createServer(), {
  drainTimeoutMs: 50,
  onClose: () => new Promise(() => undefined),
});
lifecycle.close().then(() => process.exit(0), () => process.exit(1));
`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    });

    expect(child.status).toBe(1);
  });

  it('rejects listen with the bind error', async () => {
    const first = http.createServer();
    const second = http.createServer();

    servers.push(first, second);

    const address = (await createLifecycle(first).listen(0, '127.0.0.1')) as AddressInfo;

    await expect(createLifecycle(second).listen(address.port, '127.0.0.1')).rejects.toThrow(
      'EADDRINUSE',
    );
  });

  it('answers 503 on readiness while still accepting during the grace period', async () => {
    let lifecycle!: ILifecycle;
    const { server, url } = await listen(
      (req, res) => lifecycle.health(req, res, () => res.end('app')),
      (instance) => {
        lifecycle = createLifecycle(instance, { health: true, readinessGraceMs: 200 });

        return lifecycle;
      },
    );

    lifecycle.setReady();

    const closed = lifecycle.close();

    expect(await getText(`${url}/readyz`)).toEqual({ status: 503, body: 'unavailable' });
    expect(server.listening).toBe(true);
    await closed;
    expect(server.listening).toBe(false);
  });

  it('joins a drain already under way on the first signal and exits once', async () => {
    const listeners = new Map<string, () => void>();

    vi.spyOn(process, 'on').mockImplementation(((signal: string, listener: () => void) => {
      listeners.set(signal, listener);

      return process;
    }) as typeof process.on);
    vi.spyOn(process, 'off').mockImplementation(((signal: string) => {
      listeners.delete(signal);

      return process;
    }) as typeof process.off);

    let release!: () => void;
    let lifecycle!: ILifecycle;

    await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance, {
          onDrain: () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        });

        return lifecycle;
      },
    );

    const onExit = vi.fn();
    const onSignal = vi.fn();
    const unsubscribe = lifecycle.handleSignals({ onExit, onSignal });
    const closed = lifecycle.close();

    listeners.get('SIGTERM')!();
    expect(onSignal).toHaveBeenCalledWith('SIGTERM');
    expect(onExit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    await closed;
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    expect(onExit).toHaveBeenCalledWith(0);
    unsubscribe();
  });
});
