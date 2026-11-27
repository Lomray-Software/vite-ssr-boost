// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import createServer from '@adapters/express/server';

const {
  appUse,
  appDisable,
  expressStaticMock,
  compressionMock,
  prepareServer,
  createViteServer,
  printServerInfoMock,
} = vi.hoisted(() => ({
  appUse: vi.fn(),
  appDisable: vi.fn(),
  expressStaticMock: vi.fn(),
  compressionMock: vi.fn(),
  prepareServer: {
    onAppCreated: vi.fn().mockResolvedValue(undefined),
    loadEntrypoint: vi.fn().mockResolvedValue({
      render: vi.fn(),
    }),
    loadHtml: vi.fn().mockResolvedValue(['<html>', '</html>']),
    getMiddlewaresConfig: vi.fn().mockReturnValue({
      compression: { level: 1 },
      expressStatic: { basename: '/assets' },
    }),
    onServerStarted: vi.fn(),
  },
  createViteServer: vi.fn(),
  printServerInfoMock: vi.fn(),
}));

appDisable.mockImplementation(() => ({ use: appUse, set: vi.fn() }));
expressStaticMock.mockImplementation(() => 'static-middleware');
compressionMock.mockImplementation(() => 'compression-middleware');
createViteServer.mockResolvedValue({
  middlewares: 'vite-middleware',
  config: { server: { https: false, host: '127.0.0.1' } },
});

vi.mock('express', () => ({
  default: Object.assign(() => ({ disable: appDisable }), { static: expressStaticMock }),
}));
vi.mock('compression', () => ({ default: compressionMock }));
vi.mock('@adapters/express/prepare-server', () => ({
  default: {
    init: vi.fn(() => prepareServer),
  },
}));
vi.mock('@helpers/print-server-info', () => ({ default: printServerInfoMock }));
vi.mock('vite', () => ({
  createServer: createViteServer,
}));
vi.mock('node:http', async () => {
  const { EventEmitter } = await import('node:events');

  return {
    default: {
      createServer: vi.fn(() =>
        Object.assign(new EventEmitter(), {
          listening: false,
          closeIdleConnections: vi.fn(),
          closeAllConnections: vi.fn(),
          address: vi.fn(() => null),
          close: vi.fn((cb?: () => void) => cb?.()),
          listen: vi.fn(function listen(
            this: { listening: boolean },
            _port: number,
            _host: string,
            cb: () => void,
          ) {
            // Node registers the callback as a `listening` listener, then emits the event.
            (this as unknown as import('node:events').EventEmitter).once('listening', cb);
            queueMicrotask(() => {
              this.listening = true;
              (this as unknown as import('node:events').EventEmitter).emit('listening');
            });

            return this;
          }),
        }),
      ),
    },
  };
});

/**
 * Minimal dev config for the express adapter.
 */
const createDevConfig = (vite: Record<string, unknown> = {}) => ({
  isProd: false,
  isHost: true,
  mode: 'development',
  getParams: () => ({ isSPA: false, port: 3000, host: '0.0.0.0' }),
  setApp: vi.fn(),
  setVite: vi.fn(),
  getVite: () => ({ config: { server: { https: false, host: '127.0.0.1' } }, ...vite }),
  getLogger: () => ({ error: vi.fn() }),
});

/**
 * Dev config whose getVite answers only what setVite stored, as ServerConfig does.
 */
const createStatefulDevConfig = () => {
  let stored: unknown;

  return {
    ...createDevConfig(),
    setVite: vi.fn((vite: unknown) => {
      stored = vite;
    }),
    getVite: () => stored,
  };
};

/**
 * A dev Vite double with its own middlewares and close.
 */
const createViteDouble = (middlewares: string) => ({
  middlewares,
  config: { server: { https: false, host: '127.0.0.1' } },
  close: vi.fn().mockResolvedValue(undefined),
});

/**
 * Wait for the queued listen callback.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('node server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create dev server and print info on run', async () => {
    const config = createDevConfig();

    const result = await createServer(config as never);
    const server = result.run({ version: '1.0.0' });

    expect(result.getLifecycle()?.isReady()).toBe(false);

    await flush();

    expect(config.setApp).toHaveBeenCalled();
    expect(config.setVite).toHaveBeenCalled();
    expect(appUse).toHaveBeenCalled();
    expect(server.listen).toHaveBeenCalledWith(3000, '0.0.0.0', expect.any(Function));
    expect(result.getLifecycle()?.isReady()).toBe(true);
    expect(prepareServer.onServerStarted).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      server,
    );
    expect(printServerInfoMock).toHaveBeenCalled();
  });

  it('should wait for the bind when close follows run at once', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const result = await createServer(createDevConfig({ close }) as never);
    const server = result.run({ isPrintInfo: false });

    await result.getLifecycle()!.close();

    expect(server.listen).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  /**
   * Make the next servers bind like Node: the listen() call returns and the caller emits
   * the bind error, so a test can attach listeners first. The list fills as run() creates them.
   */
  const mockPendingServers = async (count = 1) => {
    const http = (await import('node:http')).default;
    const { EventEmitter } = await import('node:events');
    const servers: InstanceType<typeof EventEmitter>[] = [];

    for (let index = 0; index < count; index += 1) {
      vi.mocked(http.createServer).mockImplementationOnce(() => {
        const server = Object.assign(new EventEmitter(), {
          listening: false,
          closeIdleConnections: vi.fn(),
          closeAllConnections: vi.fn(),
          close: vi.fn(),
          // Node registers the listen callback as a `listening` listener.
          listen: vi.fn((_port: number, _host: string, cb?: () => void) => {
            if (cb) {
              server.once('listening', cb);
            }

            return server;
          }),
        });

        servers.push(server);

        return server as never;
      });
    }

    return servers;
  };

  it('should leave a bind error to the server error listeners without starting', async () => {
    const failure = Object.assign(new Error('taken'), { code: 'EADDRINUSE' });
    const onError = vi.fn();
    const servers = await mockPendingServers();

    const result = await createServer(createDevConfig() as never);
    const server = result.run({ isPrintInfo: false });

    server.on('error', onError);
    servers[0].emit('error', failure);
    await flush();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.getLifecycle()?.isReady()).toBe(false);
    expect(prepareServer.onServerStarted).not.toHaveBeenCalled();
  });

  it('should run onServerStarted before listening listeners added after run', async () => {
    const result = await createServer(createDevConfig() as never);
    const server = result.run({ isPrintInfo: false });
    const seen: boolean[] = [];

    server.on('listening', () => {
      seen.push(prepareServer.onServerStarted.mock.calls.length === 1);
      seen.push(result.getLifecycle()!.isReady());
    });
    await flush();

    expect(seen).toEqual([true, true]);
  });

  it('should deliver a bind error to once and prepended once listeners alone', async () => {
    const failure = Object.assign(new Error('taken'), { code: 'EADDRINUSE' });
    const onAppended = vi.fn();
    const onPrepended = vi.fn();
    const onRejection = vi.fn();
    const servers = await mockPendingServers(2);

    process.on('unhandledRejection', onRejection);

    try {
      (await createServer(createDevConfig() as never))
        .run({ isPrintInfo: false })
        .once('error', onAppended);
      (await createServer(createDevConfig() as never))
        .run({ isPrintInfo: false })
        .prependOnceListener('error', onPrepended);

      expect(() => servers[0].emit('error', failure)).not.toThrow();
      expect(() => servers[1].emit('error', failure)).not.toThrow();
      await flush();

      expect(onAppended).toHaveBeenCalledWith(failure);
      expect(onPrepended).toHaveBeenCalledWith(failure);
      expect(onRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('should let a bind error nobody listens for throw as Node does', async () => {
    const failure = Object.assign(new Error('taken'), { code: 'EADDRINUSE' });
    const servers = await mockPendingServers();

    (await createServer(createDevConfig() as never)).run({ isPrintInfo: false });

    expect(() => servers[0].emit('error', failure)).toThrow(failure);
  });

  it('should throw an invalid port from run itself', async () => {
    const http = (await import('node:http')).default;
    const failure = Object.assign(new RangeError('bad port'), { code: 'ERR_SOCKET_BAD_PORT' });

    vi.mocked(http.createServer).mockImplementationOnce(() => {
      const { EventEmitter } = require('node:events') as typeof import('node:events');

      return Object.assign(new EventEmitter(), {
        listening: false,
        listen: vi.fn(() => {
          throw failure;
        }),
      }) as never;
    });

    const result = await createServer(createDevConfig() as never);

    expect(() => result.run({ isPrintInfo: false })).toThrow(failure);
  });

  it('should not let a failed bind hold close', async () => {
    const failure = Object.assign(new Error('taken'), { code: 'EADDRINUSE' });
    const servers = await mockPendingServers();
    const close = vi.fn().mockResolvedValue(undefined);
    const result = await createServer(createDevConfig({ close }) as never);

    result.run({ isPrintInfo: false }).once('error', vi.fn());

    const closed = result.getLifecycle()!.close();

    servers[0].emit('error', failure);

    await expect(closed).resolves.toBeUndefined();
  });

  it('should start nothing when the bind lands after the drain moved past it', async () => {
    const servers = await mockPendingServers();
    const close = vi.fn().mockResolvedValue(undefined);
    const result = await createServer(createDevConfig({ close }) as never, {
      drainTimeoutMs: 10,
    });

    result.run();
    await result.getLifecycle()!.close();
    servers[0].emit('listening');

    expect(prepareServer.onServerStarted).not.toHaveBeenCalled();
    expect(printServerInfoMock).not.toHaveBeenCalled();
    expect(result.getLifecycle()!.isReady()).toBe(false);
    expect((servers[0] as unknown as { close: () => void }).close).toHaveBeenCalledOnce();
  });

  it('should have no lifecycle before run', async () => {
    const result = await createServer(createDevConfig() as never);

    expect(result.getLifecycle()).toBeUndefined();
  });

  it('should close vite when the dev server drains', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const result = await createServer(createDevConfig({ close }) as never);

    result.run({ isPrintInfo: false });
    await flush();
    await result.getLifecycle()!.close();

    expect(close).toHaveBeenCalledTimes(1);
    expect(printServerInfoMock).not.toHaveBeenCalled();
  });

  it('should close vite once after the server stopped, beside the user hooks', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const onDrain = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn().mockResolvedValue(undefined);
    const result = await createServer(createDevConfig({ close }) as never, { onDrain, onClose });

    const server = result.run({ isPrintInfo: false });
    let release: (() => void) | undefined;

    await flush();
    // Hold the close callback: Node calls it once the last connection ended.
    vi.mocked(server.close).mockImplementationOnce((cb) => {
      release = cb as () => void;

      return server;
    });

    const closed = result.getLifecycle()!.close();

    await flush();

    expect(server.close).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

    release!();
    await closed;

    expect(close).toHaveBeenCalledTimes(1);
    expect(onDrain).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should answer health probes before application middleware once running', async () => {
    const result = await createServer(createDevConfig() as never, { health: true });
    const [health] = appUse.mock.calls[0] as [
      (req: unknown, res: unknown, next: () => void) => void,
    ];
    const next = vi.fn();
    const end = vi.fn();
    const res = { writeHead: vi.fn(() => ({ end })) };

    health({ url: '/readyz', method: 'GET' }, res, next);

    expect(next).toHaveBeenCalledTimes(1);

    result.run({ isPrintInfo: false });
    await flush();
    health({ url: '/readyz', method: 'GET' }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(end).toHaveBeenCalledWith('ok');
  });

  it('should create its own dev Vite in middleware mode when none is supplied', async () => {
    const own = createViteDouble('own-middleware');
    const config = createStatefulDevConfig();

    createViteServer.mockResolvedValueOnce(own);

    await createServer(config as never);

    expect(createViteServer).toHaveBeenCalledExactlyOnceWith({
      server: { middlewareMode: true, watch: { usePolling: true, interval: 100 } },
      appType: 'custom',
      mode: 'development',
    });
    expect(config.setVite).toHaveBeenCalledExactlyOnceWith(own);
    expect(appUse).toHaveBeenCalledWith('own-middleware');
  });

  it('should create a fresh dev Vite for a second start after a drain', async () => {
    const first = createViteDouble('first-middleware');
    const second = createViteDouble('second-middleware');
    const config = createStatefulDevConfig();

    createViteServer.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const started = await createServer(config as never);

    started.run({ isPrintInfo: false });
    await flush();
    await started.getLifecycle()!.close();

    expect(first.close).toHaveBeenCalledOnce();

    await createServer(config as never);

    expect(createViteServer).toHaveBeenCalledTimes(2);
    expect(config.setVite).toHaveBeenLastCalledWith(second);
    expect(config.getVite()).toBe(second);
    expect(second.close).not.toHaveBeenCalled();
  });

  it('should mount a supplied dev Vite without creating another', async () => {
    const supplied = createViteDouble('supplied-middleware');
    const config = createStatefulDevConfig();

    await createServer(config as never, {}, supplied as never);

    expect(createViteServer).not.toHaveBeenCalled();
    expect(appUse).toHaveBeenCalledWith('supplied-middleware');
    expect(config.setVite).toHaveBeenCalledExactlyOnceWith(supplied);
  });

  it('should close its own dev Vite once when the app setup fails', async () => {
    const own = createViteDouble('own-middleware');

    createViteServer.mockResolvedValueOnce(own);
    prepareServer.onAppCreated.mockRejectedValueOnce(new Error('setup failed'));

    await expect(createServer(createStatefulDevConfig() as never)).rejects.toThrow('setup failed');
    expect(own.close).toHaveBeenCalledOnce();
  });

  it('should leave a supplied dev Vite open when the app setup fails', async () => {
    const supplied = createViteDouble('supplied-middleware');

    prepareServer.onAppCreated.mockRejectedValueOnce(new Error('setup failed'));

    await expect(
      createServer(createStatefulDevConfig() as never, {}, supplied as never),
    ).rejects.toThrow('setup failed');
    expect(supplied.close).not.toHaveBeenCalled();
    expect(createViteServer).not.toHaveBeenCalled();
  });

  it('should register prod middlewares for spa mode', async () => {
    const config = {
      isProd: true,
      isHost: false,
      mode: 'production',
      getParams: () => ({
        isSPA: true,
        root: '/root',
        publicDir: '/public',
        port: 3000,
        host: '127.0.0.1',
      }),
      setApp: vi.fn(),
      getVite: () => undefined,
      getLogger: () => ({ error: vi.fn() }),
    };

    await createServer(config as never);

    expect(compressionMock).toHaveBeenCalled();
    expect(expressStaticMock).toHaveBeenCalled();
  });
});
