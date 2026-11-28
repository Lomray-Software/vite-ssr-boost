import fs from 'node:fs';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrepareServer from '@adapters/express/prepare-server';

describe('PrepareServer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    (globalThis as Record<symbol, Set<string> | undefined>)[
      Symbol.for('@lomray/vite-ssr-boost/diagnostics')
    ]?.clear();
  });

  const createConfig = (isProd = false) => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
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

  it('warns once per configured Express-only hook across entry reloads', async () => {
    const config = createConfig(false);
    config.getVite().ssrLoadModule.mockResolvedValue({
      default: {
        render: vi.fn(),
        init: vi.fn().mockResolvedValue({
          onRequest: vi.fn(),
          onServerCreated: vi.fn(),
          onServerStarted: vi.fn(),
        }),
        routes: [],
        middlewares: { expressStatic: { maxAge: 0 } },
      },
    });

    const service = PrepareServer.init(config as never);

    await service.loadEntrypoint();
    await service.loadEntrypoint();

    const messages = config.getLogger().warn.mock.calls.map(([message]) => message as string);

    expect(messages).toHaveLength(4);
    expect(messages.every((message) => message.includes('SSR_BOOST_DEPRECATED_EXPRESS_HOOK'))).toBe(
      true,
    );
    expect(messages.every((message) => message.includes('9.0'))).toBe(true);

    for (const hook of [
      'onRequest(req, res)',
      'onServerCreated',
      'onServerStarted',
      'middlewares.expressStatic',
    ]) {
      expect(
        messages.some((message) => message.startsWith(`[ssr-boost]`) && message.includes(hook)),
      ).toBe(true);
    }
  });

  it('does not warn for entries without Express-only hooks', async () => {
    const config = createConfig(false);
    config.getVite().ssrLoadModule.mockResolvedValue({
      default: {
        render: vi.fn(),
        init: vi.fn().mockResolvedValue({ onResponse: vi.fn() }),
        routes: [],
        middlewares: { compression: false },
      },
    });

    await PrepareServer.init(config as never).loadEntrypoint();

    expect(config.getLogger().warn).not.toHaveBeenCalled();
  });

  it('keeps Express-only hooks silent with SSR_BOOST_DIAGNOSTICS=0', async () => {
    vi.stubEnv('SSR_BOOST_DIAGNOSTICS', '0');
    const config = createConfig(false);
    config.getVite().ssrLoadModule.mockResolvedValue({
      default: {
        render: vi.fn(),
        init: vi.fn().mockResolvedValue({ onServerCreated: vi.fn() }),
        routes: [],
      },
    });

    await PrepareServer.init(config as never).loadEntrypoint();

    expect(config.getLogger().warn).not.toHaveBeenCalled();
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

  it('loads and transforms through the Vite it was given, not the config one', async () => {
    const config = createConfig(false);
    const shell = '<script src="/app/client.ts" async></script><!--ssr-outlet--><footer />';
    const render = vi.fn();
    const own = {
      ssrLoadModule: vi.fn().mockResolvedValue({ default: { render, routes: [] } }),
      transformIndexHtml: vi.fn().mockResolvedValue(shell),
      config: { base: '/app/' },
    };

    vi.spyOn(fs, 'readFileSync').mockReturnValue(shell as never);

    const service = PrepareServer.init(config as never, undefined, own as never);
    const result = await service.loadEntrypoint();
    const [header] = await service.loadHtml({ originalUrl: '/' } as never);

    expect(result.render).toBe(render);
    expect(own.ssrLoadModule).toHaveBeenCalledOnce();
    expect(own.transformIndexHtml).toHaveBeenCalledWith('/', shell, '/index.html');
    expect(header).toContain('<script src="/app/client.ts"></script>');
    expect(config.getVite().ssrLoadModule).not.toHaveBeenCalled();
    expect(config.getVite().transformIndexHtml).not.toHaveBeenCalled();
  });

  it('reuses the production shell while keeping returned tuples isolated', async () => {
    const config = createConfig(true);
    const read = vi.spyOn(fs, 'readFileSync').mockReturnValue('header<!--ssr-outlet-->footer');
    const service = PrepareServer.init(config as never);
    const first = await service.loadHtml({ originalUrl: '/' } as never);
    first[0] = 'request-specific';

    expect(await service.loadHtml({ originalUrl: '/items' } as never)).toEqual([
      'header',
      'footer',
    ]);
    expect(read).toHaveBeenCalledTimes(1);
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

  it.each([false, true])(
    'rejects zero and multiple outlets even with diagnostics off (isProd=%s)',
    async (isProd) => {
      vi.stubEnv('SSR_BOOST_DIAGNOSTICS', '0');
      const config = createConfig(isProd);
      const read = vi.spyOn(fs, 'readFileSync');

      for (const html of ['<html></html>', '<!--ssr-outlet--><!--ssr-outlet-->']) {
        read.mockReturnValue(html);
        config.getVite().transformIndexHtml.mockResolvedValue(html);
        await expect(
          PrepareServer.init(config as never).loadHtml({ originalUrl: '/' } as never),
        ).rejects.toThrow(
          '[ssr-boost] SSR_BOOST_OUTLET_MISSING: Invalid HTML shell in "/root/index.html": expected exactly one non-empty outlet "<!--ssr-outlet-->". See https://lomray-software.github.io/vite-ssr-boost/reference/diagnostics#ssr_boost_outlet_missing',
        );
      }
    },
  );

  it('validates the shell after Vite transforms it', async () => {
    const config = createConfig(false);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('<!--ssr-outlet-->');
    config.getVite().transformIndexHtml.mockResolvedValue('<html></html>');
    await expect(
      PrepareServer.init(config as never).loadHtml({ originalUrl: '/' } as never),
    ).rejects.toThrow('SSR_BOOST_OUTLET_MISSING');
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
