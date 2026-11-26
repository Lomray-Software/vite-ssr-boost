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
            queueMicrotask(() => {
              this.listening = true;
              cb();
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

  it('should leave a bind error to the server error listeners without starting', async () => {
    const http = (await import('node:http')).default;
    const failure = Object.assign(new Error('taken'), { code: 'EADDRINUSE' });
    const onError = vi.fn();

    vi.mocked(http.createServer).mockImplementationOnce(() => {
      const { EventEmitter } = require('node:events') as typeof import('node:events');
      const server = Object.assign(new EventEmitter(), {
        listening: false,
        listen: vi.fn(() => {
          queueMicrotask(() => server.emit('error', failure));

          return server;
        }),
      });

      return server as never;
    });

    const result = await createServer(createDevConfig() as never);
    const server = result.run({ isPrintInfo: false });

    server.on('error', onError);
    await flush();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.getLifecycle()?.isReady()).toBe(false);
    expect(prepareServer.onServerStarted).not.toHaveBeenCalled();
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

  it('should close vite once beside a user onDrain hook', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const onDrain = vi.fn().mockResolvedValue(undefined);
    const result = await createServer(createDevConfig({ close }) as never, { onDrain });

    result.run({ isPrintInfo: false });
    await flush();
    await result.getLifecycle()!.close();

    expect(close).toHaveBeenCalledTimes(1);
    expect(onDrain).toHaveBeenCalledTimes(1);
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
