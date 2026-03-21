import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import CliActions from '@constants/cli-actions';
import PLUGIN_NAME from '@constants/plugin-name';
import ViteSsrBoostPlugin from '../src/plugin';

describe('ViteSsrBoostPlugin branches', () => {
  afterEach(() => {
    delete process.env.SSR_BOOST_ACTION;
    delete process.env.SSR_BOOST_IS_SSR;
    delete process.env.SSR_BOOST_CUSTOM_ENTRYPOINT_BUILD_NAME;
    // @ts-expect-error test cleanup
    delete global.viteBoostAction;
  });

  it('should enable manifest for client build in ssr build mode', () => {
    process.env.SSR_BOOST_ACTION = CliActions.build;
    process.env.SSR_BOOST_IS_SSR = '1';

    const plugin = ViteSsrBoostPlugin().find(({ name }) => name === PLUGIN_NAME)!;
    const config = getConfigHook(plugin)({ define: {}, build: {} }, { isSsrBuild: false }) as {
      build: { manifest?: boolean };
      define: { __IS_SSR__: boolean };
    };

    expect(config.define.__IS_SSR__).toBe(true);
    expect(config.build.manifest).toBe(true);
  });

  it('should return custom app config for ssr build', () => {
    process.env.SSR_BOOST_ACTION = CliActions.build;

    const plugin = ViteSsrBoostPlugin().find(({ name }) => name === PLUGIN_NAME)!;
    const config = getConfigHook(plugin)({ define: {}, build: {} }, { isSsrBuild: true }) as {
      publicDir: boolean;
      appType?: string;
      define: { __IS_SSR__: boolean };
    };

    expect(config.publicDir).toBe(false);
    expect(config.appType).toBe('custom');
    expect(config.define.__IS_SSR__).toBe(false);
  });

  it('should add spa index and custom entrypoint plugins when configured', () => {
    process.env.SSR_BOOST_CUSTOM_ENTRYPOINT_BUILD_NAME = 'worker';

    const plugins = ViteSsrBoostPlugin({
      spaIndex: true,
      entrypoint: [{ name: 'worker', type: 'spa' as const }],
    });
    const names = plugins.map(({ name }) => name);

    expect(names).toContain('@lomray/vite-ssr-boost-create-spa-entrypoint');
    expect(names).toContain('@lomray/vite-ssr-boost-handle-custom-entrypoint');
  });
});
const getConfigHook = (plugin: ReturnType<typeof ViteSsrBoostPlugin>[number]) =>
  (typeof plugin.config === 'function' ? plugin.config : plugin.config?.handler) as any;
