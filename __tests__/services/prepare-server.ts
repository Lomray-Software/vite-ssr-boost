import fs from 'node:fs';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrepareServer from '@services/prepare-server';

describe('PrepareServer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createConfig = (isProd = false) => {
    const logger = { error: vi.fn(), info: vi.fn() };
    const vite = {
      ssrLoadModule: vi.fn(),
      transformIndexHtml: vi.fn(),
      config: { base: '/' },
    };

    return {
      isProd,
      mode: isProd ? 'production' : 'development',
      getParams: () => ({
        root: '/root',
        isProd,
        serverFile: '/server.js',
        indexFile: '/index.html',
        clientFile: 'client.ts',
      }),
      getVite: () => vite,
      getLogger: () => logger,
      setLogger: vi.fn(),
      getApp: () => ({ app: true }),
    };
  };

  it('should load dev entrypoint and cache it for subsequent prod calls', async () => {
    const config = createConfig(false);
    const render = vi.fn();
    const init = vi.fn().mockResolvedValue({
      onServerCreated: vi.fn(),
      onServerStarted: vi.fn(),
      onResponse: vi.fn(),
    });
    config.getVite().ssrLoadModule.mockResolvedValue({
      default: {
        render,
        init,
        routes: [],
        abortDelay: 10,
        loggerDev: { info: vi.fn() },
        middlewares: { compression: { level: 1 } },
      },
    });

    const service = PrepareServer.init(config as never);
    const result = await service.loadEntrypoint();

    expect(result.render).toBe(render);
    expect(result.abortDelay).toBe(10);
    expect(config.setLogger).toHaveBeenCalled();
    expect(service.getMiddlewaresConfig()).toEqual({
      compression: { level: 1 },
      expressStatic: { basename: '/' },
    });
  });

  it('should remove init when shouldInit is false', async () => {
    const config = createConfig(false);
    config.getVite().ssrLoadModule.mockResolvedValue({
      default: {
        render: vi.fn(),
        init: vi.fn(),
        routes: [],
      },
    });

    const service = PrepareServer.init(config as never);
    const result = await service.loadEntrypoint(false);

    expect(result).not.toHaveProperty('init');
  });

  it('should load and transform html in dev mode', async () => {
    const config = createConfig(false);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      '<script src="/client.ts" async></script><!--ssr-outlet--><footer />' as never,
    );
    config
      .getVite()
      .transformIndexHtml.mockResolvedValue(
        '<script src="/client.ts" async></script><!--ssr-outlet--><footer />',
      );

    const service = PrepareServer.init(config as never);
    const [header, footer] = await service.loadHtml({ originalUrl: '/' } as never);

    expect(header).toContain('<script src="/client.ts"></script>');
    expect(footer).toContain('<footer');
  });

  it('should call app created hook', async () => {
    const config = createConfig(false);
    const onServerCreated = vi.fn();
    config.getVite().ssrLoadModule.mockResolvedValue({
      default: {
        render: vi.fn(),
        init: vi.fn().mockResolvedValue({
          onServerCreated,
        }),
        routes: [],
      },
    });

    const service = PrepareServer.init(config as never);
    await service.onAppCreated();

    expect(onServerCreated).toHaveBeenCalled();
  });

  it('should stop process with friendly message when prod build is missing', async () => {
    const config = createConfig(false);
    const error = new Error('Cannot find module /build/server.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    config.getVite().ssrLoadModule.mockRejectedValue(error);

    const service = PrepareServer.init(config as never);
    await service.loadEntrypoint();

    expect(config.getLogger().error).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
