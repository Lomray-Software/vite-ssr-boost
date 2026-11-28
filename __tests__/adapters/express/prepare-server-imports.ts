import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const parser = vi.hoisted(() => ({ loaded: false }));

vi.mock('parse5', async (importOriginal) => {
  parser.loaded = true;

  return importOriginal();
});

/**
 * Create a minimal server config for the given mode.
 */
const createConfig = (isProd: boolean) => {
  const shell = '<script src="/client.ts" async></script><!--ssr-outlet--><footer />';

  return {
    isProd,
    getParams: () => ({
      root: '/root',
      isProd,
      serverFile: '/server.js',
      indexFile: '/index.html',
      clientFile: 'client.ts',
    }),
    getVite: () => ({
      transformIndexHtml: vi.fn().mockResolvedValue(shell),
      config: { base: '/' },
    }),
    getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  };
};

describe('PrepareServer imports', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the HTML parser out of a production start and loads it for dev', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      '<script src="/client.ts" async></script><!--ssr-outlet--><footer />' as never,
    );

    const { default: PrepareServer } = await import('@adapters/express/prepare-server');
    const [prodHeader] = await PrepareServer.init(createConfig(true) as never).loadHtml({
      originalUrl: '/',
    } as never);

    expect(prodHeader).toContain('async');
    expect(parser.loaded).toBe(false);

    const [devHeader] = await PrepareServer.init(createConfig(false) as never).loadHtml({
      originalUrl: '/',
    } as never);

    expect(devHeader).toContain('<script src="/client.ts"></script>');
    expect(parser.loaded).toBe(true);
  });
});
