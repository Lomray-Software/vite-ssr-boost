// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import createServer from '@node/server';

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

appDisable.mockImplementation(() => ({ use: appUse }));
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
vi.mock('@services/prepare-server', () => ({
  default: {
    init: vi.fn(() => prepareServer),
  },
}));
vi.mock('@helpers/print-server-info', () => ({ default: printServerInfoMock }));
vi.mock('vite', () => ({
  createServer: createViteServer,
}));
vi.mock('node:http', () => ({
  default: {
    createServer: vi.fn(() => ({
      listen: (port: number, host: string, cb: () => void) => {
        const server = { port, host };
        queueMicrotask(cb);

        return server;
      },
    })),
  },
}));

describe('node server', () => {
  it('should create dev server and print info on run', async () => {
    const config = {
      isProd: false,
      isHost: true,
      mode: 'development',
      getParams: () => ({ isSPA: false, port: 3000, host: '0.0.0.0' }),
      setApp: vi.fn(),
      setVite: vi.fn(),
      getVite: () => ({ config: { server: { https: false, host: '127.0.0.1' } } }),
      getLogger: () => ({ error: vi.fn() }),
    };

    const result = await createServer(config as never);
    const server = result.run({ version: '1.0.0' });
    await Promise.resolve();

    expect(config.setApp).toHaveBeenCalled();
    expect(config.setVite).toHaveBeenCalled();
    expect(appUse).toHaveBeenCalled();
    expect(printServerInfoMock).toHaveBeenCalled();
    expect(server).toEqual({ port: 3000, host: '0.0.0.0' });
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
