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

  it('should pre-bundle browser imports and preserve user optimization options in development', () => {
    process.env.SSR_BOOST_ACTION = CliActions.dev;
    const plugin = ViteSsrBoostPlugin()[0]!;
    const exclude = ['custom-excluded'];
    const ssr = { optimizeDeps: { include: ['server-only'] } };
    const config = getConfigHook(plugin)(
      {
        optimizeDeps: { include: ['custom-included', 'react'], exclude, entries: ['custom.html'] },
        ssr,
      },
      { command: 'serve', isSsrBuild: false },
    );

    expect(config.optimizeDeps.include).toEqual(
      expect.arrayContaining([
        'custom-included',
        'react',
        'react-dom',
        'react-dom/client',
        'react-router',
        'hoist-non-react-statics',
        `${PLUGIN_NAME}/browser/entry`,
        `${PLUGIN_NAME}/browser/entry.js`,
        `${PLUGIN_NAME}/helpers/import-route`,
        `${PLUGIN_NAME}/helpers/get-server-state`,
        `${PLUGIN_NAME}/components/only-client`,
        `${PLUGIN_NAME}/constants/common`,
        `${PLUGIN_NAME}/context/server`,
      ]),
    );
    expect(config.optimizeDeps.include.filter((id: string) => id === 'react')).toHaveLength(1);
    expect(config.optimizeDeps.exclude).toBe(exclude);
    expect(config.optimizeDeps.entries).toEqual(['custom.html']);
    expect(config.ssr).toBe(ssr);
    expect(ssr).toEqual({ optimizeDeps: { include: ['server-only'] } });
  });

  it('should respect excluded packages, subpaths and both public extension spellings', () => {
    const plugin = ViteSsrBoostPlugin()[0]!;
    const exclude = [
      'react-dom',
      `${PLUGIN_NAME}/components`,
      `${PLUGIN_NAME}/helpers/import-route.js`,
      `${PLUGIN_NAME}/browser/entry`,
      'custom-excluded',
    ];
    const config = getConfigHook(plugin)(
      {
        optimizeDeps: {
          include: ['custom-included', 'custom-excluded', 'react-dom/client'],
          exclude,
        },
      },
      { command: 'serve', isSsrBuild: false },
    );

    expect(config.optimizeDeps.exclude).toBe(exclude);
    expect(config.optimizeDeps.include).toContain('custom-included');
    expect(config.optimizeDeps.include).toContain('react');
    expect(config.optimizeDeps.include).toContain(`${PLUGIN_NAME}/helpers/get-server-state`);
    expect(config.optimizeDeps.include).not.toContain('custom-excluded');
    expect(config.optimizeDeps.include).not.toContain('react-dom');
    expect(config.optimizeDeps.include).not.toContain('react-dom/client');
    expect(config.optimizeDeps.include).not.toContain(`${PLUGIN_NAME}/helpers/import-route`);
    expect(config.optimizeDeps.include).not.toContain(`${PLUGIN_NAME}/helpers/import-route.js`);
    expect(config.optimizeDeps.include).not.toContain(`${PLUGIN_NAME}/browser/entry`);
    expect(config.optimizeDeps.include).not.toContain(`${PLUGIN_NAME}/browser/entry.js`);
    expect(config.optimizeDeps.include.some((id: string) => id.includes('/components/'))).toBe(
      false,
    );
  });

  it('should allow excluding all package browser imports', () => {
    const config = getConfigHook(ViteSsrBoostPlugin()[0]!)(
      { optimizeDeps: { exclude: [PLUGIN_NAME] } },
      { command: 'serve', isSsrBuild: false },
    );

    expect(config.optimizeDeps.include.some((id: string) => id.startsWith(PLUGIN_NAME))).toBe(
      false,
    );
    expect(config.optimizeDeps.include).toContain('react');
  });

  it.each([false, true])(
    'should leave optimization untouched during build (SSR: %s)',
    (isSsrBuild) => {
      process.env.SSR_BOOST_ACTION = CliActions.build;
      const optimizeDeps = { include: ['user-dependency'], exclude: ['react'] };
      const ssr = { optimizeDeps: { include: ['server-only'] } };
      const hook = getConfigHook(ViteSsrBoostPlugin()[0]!);
      const config = hook({ optimizeDeps, ssr }, { command: 'build', isSsrBuild });

      expect(config.optimizeDeps).toBe(optimizeDeps);
      expect(optimizeDeps).toEqual({ include: ['user-dependency'], exclude: ['react'] });
      expect(config.ssr).toBe(ssr);
      expect(hook({}, { command: 'build', isSsrBuild })).not.toHaveProperty('optimizeDeps');
    },
  );
});
const getConfigHook = (plugin: ReturnType<typeof ViteSsrBoostPlugin>[number]) =>
  (typeof plugin.config === 'function' ? plugin.config : plugin.config?.handler) as any;
