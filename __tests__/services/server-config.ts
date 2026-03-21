import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ServerConfig from '@services/server-config';

vi.mock('@helpers/plugin-config', () => ({
  default: vi.fn(),
}));

describe('ServerConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should build production params from existing build dir', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((filepath) => filepath === './dist');

    const config = ServerConfig.init(
      { isProd: true, isOnlyClient: true, mode: 'production' },
      { port: 8080 },
    );

    expect(config.getParams()).toMatchObject({
      root: './dist',
      publicDir: '/client',
      host: '127.0.0.1',
      port: 8080,
      isSPA: true,
      isProd: true,
    });
  });

  it('should apply vite plugin config and entrypoint overrides', async () => {
    const getPluginConfig = (await import('@helpers/plugin-config')).default;
    vi.mocked(getPluginConfig).mockReturnValue({
      pluginPath: '/plugin',
      indexFile: '/client/custom-index.html',
      clientFile: '/client/custom-client.ts',
      serverFile: '/server/custom-server.js',
      entrypoint: [{ name: 'worker', type: 'spa', clientFile: '/client/worker.ts' }],
    } as never);

    const logger = { info: vi.fn() };
    const config = ServerConfig.init(
      { isHost: true, entrypointName: 'worker', mode: 'development' },
      { root: '/dist-root', port: 3000 },
    );

    config.setApp({ app: true } as never);
    config.setVite({
      config: {
        root: '/workspace',
        publicDir: '/public',
        server: { host: '127.0.0.1', port: 5173 },
        env: { VITE_PORT: '9000' },
        logger,
        plugins: [],
      },
    } as never);

    expect(config.getApp()).toEqual({ app: true });
    expect(config.getVite()).toBeDefined();
    expect(config.getLogger()).toBe(logger);
    expect(config.getPluginConfig()).toBeDefined();
    expect(config.getParams()).toMatchObject({
      root: '/workspace',
      publicDir: '/public',
      pluginPath: '/plugin',
      indexFile: '/client/custom-index.html',
      clientFile: '/client/worker.ts',
      serverFile: '/server/custom-server.js',
      host: '0.0.0.0',
      port: 9000,
      isSPA: true,
    });
  });

  it('should allow overriding logger manually', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const config = ServerConfig.init();
    const logger = { info: vi.fn() };

    config.setLogger(logger as never);

    expect(config.getLogger()).toBe(logger);
  });
});
