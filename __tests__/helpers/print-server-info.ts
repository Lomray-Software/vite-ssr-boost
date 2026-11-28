import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CliActions from '@constants/cli-actions';
import printServerInfo from '@helpers/print-server-info';

vi.mock('@helpers/resolve-server-urls', () => ({
  default: vi.fn(),
}));

vi.mock('@helpers/print-server-urls', () => ({
  default: vi.fn(),
}));

describe('printServerInfo', () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it('should print dev info and delegate url printing to vite', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const resolveServerUrls = (await import('@helpers/resolve-server-urls')).default;
    vi.mocked(resolveServerUrls).mockResolvedValue({
      local: ['http://localhost:3000'],
      network: [],
    });
    vi.stubGlobal('viteBoostStartTime', 1);

    const info = vi.fn();
    const printUrls = vi.fn();
    const config = {
      mode: 'development',
      getPluginConfig: () => ({ action: CliActions.dev }),
      getParams: () => ({ isProd: false, host: 'localhost', root: '/root', isSPA: false }),
      getLogger: () => ({ info, hasWarned: false }),
      getVite: () => ({
        config: { server: { https: false }, mode: 'development', rawBase: '/app/' },
        printUrls,
      }),
    };

    await printServerInfo(config as never, {
      version: '1.2.3',
      server: {} as never,
    });

    expect(info).toHaveBeenCalled();
    expect(printUrls).toHaveBeenCalledOnce();
  });

  it('prints the urls of the given dev Vite over the config one', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const resolveServerUrls = (await import('@helpers/resolve-server-urls')).default;
    const urls = { local: ['http://localhost:3001'], network: [] };
    vi.mocked(resolveServerUrls).mockResolvedValue(urls);
    vi.stubGlobal('viteBoostStartTime', 1);

    const createVite = () => ({
      config: { server: { https: false }, mode: 'development', rawBase: '/' },
      printUrls: vi.fn(),
      resolvedUrls: null as unknown,
    });
    const own = createVite();
    const held = createVite();
    const config = {
      mode: 'development',
      getPluginConfig: () => ({ action: CliActions.dev }),
      getParams: () => ({ isProd: false, host: 'localhost', root: '/root', isSPA: false }),
      getLogger: () => ({ info: vi.fn(), hasWarned: false }),
      getVite: () => held,
    };

    await printServerInfo(config as never, { server: {} as never, vite: own as never });

    expect(own.printUrls).toHaveBeenCalledOnce();
    expect(own.resolvedUrls).toBe(urls);
    expect(held.printUrls).not.toHaveBeenCalled();
    expect(held.resolvedUrls).toBeNull();
  });

  it('should print prod info and use printServerUrls when urls resolved', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const resolveServerUrls = (await import('@helpers/resolve-server-urls')).default;
    const printServerUrls = (await import('@helpers/print-server-urls')).default;
    vi.mocked(resolveServerUrls).mockResolvedValue({
      local: ['http://localhost:3000'],
      network: [],
    });

    const info = vi.fn();
    const config = {
      mode: 'production',
      getPluginConfig: () => ({ action: CliActions.build }),
      getParams: () => ({ isProd: true, host: 'localhost', root: '/root', isSPA: true }),
      getLogger: () => ({ info, hasWarned: true }),
      getVite: () => ({
        config: { server: { https: true }, rawBase: '' },
      }),
    };

    await printServerInfo(config as never, {
      version: '2.0.0',
      server: {} as never,
    });

    expect(printServerUrls).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalled();
  });

  it('uses the recorded pathname when the production base is a full asset URL', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const resolveServerUrls = (await import('@helpers/resolve-server-urls')).default;
    const config = {
      mode: 'production',
      getPluginConfig: () => undefined,
      getParams: () => ({ isProd: true, host: 'localhost', root: '/root', base: 'https://cdn.example.com/store/' }),
      getLogger: () => ({ info: vi.fn() }),
      getVite: () => undefined,
    };

    await printServerInfo(config as never, { server: {} as never });

    expect(resolveServerUrls).toHaveBeenCalledWith({}, { host: 'localhost', isHttps: false, rawBase: '/store/' });
  });
});
