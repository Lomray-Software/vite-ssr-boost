import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PLUGIN_NAME from '@constants/plugin-name';
import {
  getCurrentEntrypoint,
  getCurrentEntrypointName,
  setCurrentEntrypointName,
  ViteHandleCustomEntrypointPlugin,
} from '@plugins/handle-custom-entrypoint';

const getApplyHook = (plugin: ReturnType<typeof ViteHandleCustomEntrypointPlugin>) =>
  plugin.apply as any;
const getConfigHook = (plugin: ReturnType<typeof ViteHandleCustomEntrypointPlugin>) =>
  (typeof plugin.config === 'function' ? plugin.config : plugin.config?.handler) as any;
const getConfigResolvedHook = (plugin: ReturnType<typeof ViteHandleCustomEntrypointPlugin>) =>
  (typeof plugin.configResolved === 'function'
    ? plugin.configResolved
    : plugin.configResolved?.handler) as any;
const getTransformHook = (plugin: ReturnType<typeof ViteHandleCustomEntrypointPlugin>) =>
  (typeof plugin.transform === 'function' ? plugin.transform : plugin.transform?.handler) as any;
const getTransformIndexHtmlHook = (plugin: ReturnType<typeof ViteHandleCustomEntrypointPlugin>) =>
  (typeof plugin.transformIndexHtml === 'function'
    ? plugin.transformIndexHtml
    : plugin.transformIndexHtml?.handler) as any;
const getCloseBundleHook = (plugin: ReturnType<typeof ViteHandleCustomEntrypointPlugin>) =>
  (typeof plugin.closeBundle === 'function'
    ? plugin.closeBundle
    : plugin.closeBundle?.handler) as any;

describe('handle-custom-entrypoint', () => {
  afterEach(() => {
    delete process.env.SSR_BOOST_CUSTOM_ENTRYPOINT_BUILD_NAME;
    vi.restoreAllMocks();
  });

  it('should get and set current entrypoint name', () => {
    expect(getCurrentEntrypointName()).toBeUndefined();
    setCurrentEntrypointName('worker');
    expect(getCurrentEntrypointName()).toBe('worker');
  });

  it('should resolve current entrypoint only for client entrypoint', () => {
    expect(
      getCurrentEntrypoint(
        [
          { name: 'worker', type: 'spa' },
          { name: 'api', type: 'ssr', serverFile: 'server.ts' },
        ],
        'worker',
      ),
    ).toEqual({ name: 'worker', type: 'spa' });

    expect(
      getCurrentEntrypoint([{ name: 'api', type: 'ssr', serverFile: 'server.ts' }], 'api'),
    ).toBeNull();
  });

  it('should transform html and rename built index file', () => {
    const plugin = ViteHandleCustomEntrypointPlugin({
      entrypoint: {
        name: 'worker',
        type: 'spa',
        indexFile: 'index.worker.html',
        clientFile: './worker.ts',
      },
    });
    const map = {
      version: 3,
      names: [],
      sources: ['client.ts'],
      sourcesContent: [null],
      mappings: '',
    };
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const renameSync = vi.spyOn(fs, 'renameSync').mockImplementation(() => undefined);

    expect(getApplyHook(plugin)({}, { isSsrBuild: false })).toBe(true);
    expect(getApplyHook(plugin)({}, { isSsrBuild: true })).toBe(false);
    expect(getConfigHook(plugin)({ root: '/root', build: {} }, {} as never)).toEqual({
      root: '/root',
      build: {
        rollupOptions: {
          input: path.resolve('/root', 'index.worker.html'),
        },
      },
    });

    getConfigResolvedHook(plugin)({
      root: '/root',
      build: { outDir: 'dist' },
      plugins: [
        {
          name: PLUGIN_NAME,
          pluginOptions: { clientFile: './client.ts' },
        },
      ],
    } as never);

    expect(
      getTransformHook(plugin).call(
        { getCombinedSourcemap: () => map } as never,
        '<script src="/client.ts"></script>',
        '/root/index.worker.html',
      ),
    ).toEqual({
      code: '<script src="/worker.ts"></script>',
      map: JSON.stringify(map),
    });

    expect(
      getTransformIndexHtmlHook(plugin)('<script src="/client.ts"></script>', {
        originalUrl: '/index.worker.html',
        server: { config: { command: 'serve' } },
      } as never),
    ).toBe('<script src="/worker.ts"></script>');

    getCloseBundleHook(plugin)();

    expect(renameSync).toHaveBeenCalledWith(
      path.resolve('/root/dist', 'index.worker.html'),
      path.resolve('/root/dist', 'index.html'),
    );
  });

  it('should keep original html when replacement is not applicable', () => {
    const plugin = ViteHandleCustomEntrypointPlugin({
      entrypoint: {
        name: 'worker',
        type: 'spa',
      },
    });
    const map = {
      version: 3,
      names: [],
      sources: ['client.ts'],
      sourcesContent: [null],
      mappings: '',
    };

    expect(
      getTransformHook(plugin).call(
        { getCombinedSourcemap: () => map } as never,
        '<html></html>',
        '/root/index.html',
      ),
    ).toEqual({
      code: '<html></html>',
      map: JSON.stringify(map),
    });
  });
});
