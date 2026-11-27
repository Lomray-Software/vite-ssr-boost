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

    vi.spyOn(process, 'prependListener').mockImplementation(((
      signal: string,
      listener: () => void,
    ) => {
      listeners.set(signal, listener);

      return process;
    }) as typeof process.prependListener);
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

  it('leaves a signal that shouldHandle declines when it arrives', async () => {
    const listeners = new Map<string, () => void>();

    vi.spyOn(process, 'prependListener').mockImplementation(((
      signal: string,
      listener: () => void,
    ) => {
      listeners.set(signal, listener);

      return process;
    }) as typeof process.prependListener);
    vi.spyOn(process, 'off').mockImplementation(((signal: string) => {
      listeners.delete(signal);

      return process;
    }) as typeof process.off);

    let lifecycle!: ILifecycle;

    await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance);

        return lifecycle;
      },
    );

    let isHandled = false;
    const onExit = vi.fn();
    const onSignal = vi.fn();
    const shouldHandle = vi.fn(() => isHandled);
    const unsubscribe = lifecycle.handleSignals({ onExit, onSignal, shouldHandle });

    listeners.get('SIGTERM')!();
    listeners.get('SIGTERM')!();
    expect(shouldHandle).toHaveBeenCalledWith('SIGTERM');
    expect(onSignal).not.toHaveBeenCalled();
    expect(lifecycle.isDraining()).toBe(false);

    isHandled = true;
    listeners.get('SIGINT')!();
    expect(onSignal).toHaveBeenCalledWith('SIGINT');
    expect(lifecycle.isDraining()).toBe(true);
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(0));
    unsubscribe();
  });

  it('subscribes ahead of signal listeners already on the process', async () => {
    const earlier = vi.fn();
    let lifecycle!: ILifecycle;

    process.on('SIGTERM', earlier);

    try {
      await listen(
        (_req, res) => res.end('app'),
        (instance) => {
          lifecycle = createLifecycle(instance);

          return lifecycle;
        },
      );

      const before = process.listeners('SIGTERM');
      const unsubscribe = lifecycle.handleSignals({ shouldHandle: () => false });

      try {
        const [first, ...rest] = process.listeners('SIGTERM');

        expect(before).not.toContain(first);
        expect(rest).toEqual(before);
      } finally {
        unsubscribe();
      }

      expect(process.listeners('SIGTERM')).toEqual(before);
    } finally {
      process.off('SIGTERM', earlier);
    }
  });

  it('lets two lifecycles subscribe at once without moving each other forever', async () => {
    const create = async (): Promise<ILifecycle> => {
      let lifecycle!: ILifecycle;

      await listen(
        (_req, res) => res.end('app'),
        (instance) => {
          lifecycle = createLifecycle(instance);

          return lifecycle;
        },
      );

      return lifecycle;
    };
    const first = await create();
    const second = await create();
    const events = ['SIGTERM', 'SIGINT', 'newListener'];
    const counts = events.map((event) => process.listenerCount(event));
    const unsubscribers: (() => void)[] = [];

    try {
      unsubscribers.push(first.handleSignals({ shouldHandle: () => false }));
      unsubscribers.push(second.handleSignals({ shouldHandle: () => false }));

      const isTimerFired = await new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(true), 10);
      });

      expect(isTimerFired).toBe(true);
      expect(process.listenerCount('SIGTERM')).toBe(counts[0] + 2);
    } finally {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    }

    expect(events.map((event) => process.listenerCount(event))).toEqual(counts);
  });

  it('never adds back a signal listener the application removed', async () => {
    let lifecycle!: ILifecycle;

    await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance);

        return lifecycle;
      },
    );

    const before = process.listeners('SIGTERM');
    const own = vi.fn();
    const unsubscribe = lifecycle.handleSignals({ shouldHandle: () => false });

    try {
      const [ours] = process.listeners('SIGTERM');

      process.removeAllListeners('SIGTERM');
      process.on('SIGTERM', own);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(process.listeners('SIGTERM')).toEqual([own]);
      expect(process.listeners('SIGTERM')).not.toContain(ours);
    } finally {
      unsubscribe();
      process.off('SIGTERM', own);
      before.forEach((listener) => process.on('SIGTERM', listener as () => void));
    }
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

  it('drops a tunnel whose upgrade request completes after the server stopped', async () => {
    let lifecycle!: ILifecycle;
    const { server } = await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance, { drainTimeoutMs: 5000 });

        return lifecycle;
      },
    );
    const handled = vi.fn();

    server.on('upgrade', (_req, socket: Socket) => {
      handled();
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n',
      );
    });

    const client = net.connect((server.address() as AddressInfo).port, '127.0.0.1');

    // A paused client never reads the end of the stream, so it would never see the close.
    client.resume();
    await new Promise((resolve) => client.once('connect', resolve));
    client.write('GET /hmr HTTP/1.1\r\nHost: test\r\n');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const clientClosed = new Promise((resolve) => client.once('close', resolve));
    const startedAt = Date.now();
    const closed = lifecycle.close();

    await new Promise((resolve) => setTimeout(resolve, 50));
    client.write('Connection: Upgrade\r\nUpgrade: test\r\n\r\n');
    await closed;
    await clientClosed;

    expect(handled).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBeLessThan(2000);
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

  it('joins a native close that started before the lifecycle existed', async () => {
    const { server } = await listen(
      () => undefined,
      () => createLifecycle(http.createServer()),
    );
    let accepted: Socket | undefined;

    server.on('upgrade', (_req, socket: Socket) => {
      accepted = socket;
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n',
      );
    });

    const client = await upgrade(server);
    const onClose = vi.fn();

    server.close();

    const lifecycle = createLifecycle(server, { drainTimeoutMs: 5000, onClose });
    const closed = lifecycle.close();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onClose).not.toHaveBeenCalled();
    accepted?.destroy();
    client.destroy();
    await closed;
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps waiting for a native close when the connection count fails', async () => {
    /**
     * Start a server, hold an upgraded socket, close it natively and break its connection count.
     */
    const startClosing = async (): Promise<{ server: http.Server; release: () => void }> => {
      const { server } = await listen(
        () => undefined,
        () => createLifecycle(http.createServer()),
      );
      let accepted: Socket | undefined;

      server.on('upgrade', (_req, socket: Socket) => {
        accepted = socket;
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n',
        );
      });

      const client = await upgrade(server);

      server.close();
      vi.spyOn(server, 'getConnections').mockImplementation((callback) => {
        callback(new Error('count failed'), 0);

        return server;
      });

      return {
        server,
        release: () => {
          accepted?.destroy();
          client.destroy();
        },
      };
    };

    const joined = await startClosing();
    const onClose = vi.fn();
    const closed = createLifecycle(joined.server, { drainTimeoutMs: 5000, onClose }).close();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onClose).not.toHaveBeenCalled();
    joined.release();
    await closed;
    expect(onClose).toHaveBeenCalledOnce();

    const stuck = await startClosing();

    await expect(createLifecycle(stuck.server, { drainTimeoutMs: 50 }).close()).rejects.toThrow(
      '[ssr-boost] the server did not close within 50 ms: ' +
        'connections opened before the lifecycle remain.',
    );
    stuck.release();
  });

  it('rejects close when a socket from before the lifecycle outlives the deadline', async () => {
    const { server } = await listen(
      () => undefined,
      () => createLifecycle(http.createServer()),
    );

    let accepted: Socket | undefined;

    server.on('upgrade', (_req, socket: Socket) => {
      accepted = socket;
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n',
      );
    });

    const client = await upgrade(server);
    const lifecycle = createLifecycle(server, { drainTimeoutMs: 50 });
    const startedAt = Date.now();

    await expect(lifecycle.close()).rejects.toThrow(
      '[ssr-boost] the server did not close within 50 ms: ' +
        'connections opened before the lifecycle remain.',
    );
    expect(Date.now() - startedAt).toBeLessThan(2000);
    accepted?.destroy();
    client.destroy();
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

  it('refuses a managed listen before the previous native close finished', async () => {
    const server = http.createServer();
    const lifecycle = createLifecycle(server);

    servers.push(server);
    await lifecycle.listen(0);

    const counts = (): number[] =>
      ['listening', 'error', 'close'].map((event) => server.listenerCount(event));
    const before = counts();

    // The `close` event of this close() is still pending when the retry starts its host lookup.
    server.close();
    await expect(lifecycle.listen(0, 'localhost')).rejects.toThrow(
      'before the previous close() finished',
    );
    expect(counts()).toEqual(before);
    // A refused retry must never open a port later.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.listening).toBe(false);
    // Once the close settled, a retry binds.
    await expect(lifecycle.listen(0)).resolves.toMatchObject({ port: expect.any(Number) });
  });

  it('cancels a first managed listen with a native close from before the lifecycle', async () => {
    const server = http.createServer();

    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    // Queued before the lifecycle exists, so its `close` event is still pending.
    server.close();

    const lifecycle = createLifecycle(server);

    await expect(lifecycle.listen(0)).rejects.toThrow('cancelled by close()');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.listening).toBe(false);
    await expect(lifecycle.listen(0)).resolves.toMatchObject({ port: expect.any(Number) });
  });

  it('refuses a first managed listen while a close from before the lifecycle drains', async () => {
    const server = http.createServer();

    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const client = net.connect((server.address() as AddressInfo).port);

    await new Promise((resolve) => client.once('connect', resolve));
    await vi.waitFor(
      () =>
        new Promise<void>((resolve, reject) =>
          server.getConnections((_error, count) => (count === 1 ? resolve() : reject())),
        ),
    );

    // The open connection keeps this close() pending past the lifecycle's creation.
    const closed = new Promise((resolve) => server.close(resolve));
    const lifecycle = createLifecycle(server);

    await expect(lifecycle.listen(0)).rejects.toThrow('before the previous close() finished');
    expect(server.listening).toBe(false);
    client.destroy();
    await closed;
    await expect(lifecycle.listen(0)).resolves.toMatchObject({ port: expect.any(Number) });
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

  it('lets lifecycles of two loaded copies of the module hold signals at once', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/node/lifecycle.ts', import.meta.url)),
      'utf8',
    );
    const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
    const script = `
const http = await import('node:http');
const toUrl = (copy) => 'data:text/javascript,' + encodeURIComponent(copy);
const code = ${JSON.stringify(code)};
const first = await import(toUrl(code + '\\n// first copy'));
const second = await import(toUrl(code + '\\n// second copy'));

first.default(http.createServer()).handleSignals({ shouldHandle: () => false });
second.default(http.createServer()).handleSignals({ shouldHandle: () => false });
setTimeout(() => process.exit(0), 50);
`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      // The child holds SIGTERM, so only SIGKILL ends a hang.
      killSignal: 'SIGKILL',
      timeout: 5000,
    });

    expect(child.status, child.stderr).toBe(0);
  });

  it('rejects listen when a listener closed the server as its bind landed', async () => {
    const server = http.createServer();
    const lifecycle = createLifecycle(server);

    servers.push(server);
    server.once('listening', () => server.close());

    const counts = (): number[] => ['error', 'close'].map((event) => server.listenerCount(event));
    const before = counts();

    await expect(lifecycle.listen(0)).rejects.toThrow('closed as its bind landed');
    expect(counts()).toEqual(before);
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

  it('drains a response that an earlier request listener ended during the grace', async () => {
    let lifecycle!: ILifecycle;
    const { server, url } = await listen(
      (_req, res) => {
        if (!res.headersSent) {
          res.end('app');
        }
      },
      (instance) => {
        lifecycle = createLifecycle(instance, { readinessGraceMs: 200 });

        return lifecycle;
      },
    );

    // Prepended after the lifecycle, so it answers before the lifecycle tracker runs.
    server.prependListener('request', (_req, res) => res.end('early'));

    const closed = lifecycle.close();

    expect(await getText(url)).toEqual({ status: 200, body: 'early' });
    await expect(closed).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
  });

  it('keeps a tunnel through a readiness probe during grace and drops it after', async () => {
    let lifecycle!: ILifecycle;
    const { server, url } = await listen(
      (req, res) => lifecycle.health(req, res, () => res.end('app')),
      (instance) => {
        lifecycle = createLifecycle(instance, { health: true, readinessGraceMs: 300 });

        return lifecycle;
      },
    );

    server.on('upgrade', (_req, socket: Socket) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n',
      );
    });

    const client = await upgrade(server);
    const closed = lifecycle.close();

    expect(await getText(`${url}/readyz`)).toEqual({ status: 503, body: 'unavailable' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.destroyed).toBe(false);
    expect(server.listening).toBe(true);
    await closed;
    await vi.waitFor(() => expect(client.destroyed).toBe(true));
  });

  it('rejects close with the drain failure when onClose fails as well', async () => {
    const drainError = new Error('drain failed');
    const closeError = new Error('close failed');
    let lifecycle!: ILifecycle;
    const { server } = await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance, {
          onDrain: () => Promise.reject(drainError),
          onClose: () => Promise.reject(closeError),
        });

        return lifecycle;
      },
    );

    await expect(lifecycle.close()).rejects.toBe(drainError);
    expect(server.listening).toBe(false);
  });

  it('rejects close with the onClose failure when the drain succeeded', async () => {
    const closeError = new Error('close failed');
    let lifecycle!: ILifecycle;

    await listen(
      (_req, res) => res.end('app'),
      (instance) => {
        lifecycle = createLifecycle(instance, { onClose: () => Promise.reject(closeError) });

        return lifecycle;
      },
    );

    await expect(lifecycle.close()).rejects.toBe(closeError);
  });

  it('joins a drain already under way on the first signal and exits once', async () => {
    const listeners = new Map<string, () => void>();

    vi.spyOn(process, 'prependListener').mockImplementation(((
      signal: string,
      listener: () => void,
    ) => {
      listeners.set(signal, listener);

      return process;
    }) as typeof process.prependListener);
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
