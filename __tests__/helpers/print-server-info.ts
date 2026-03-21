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
});
