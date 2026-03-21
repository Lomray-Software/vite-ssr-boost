import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
import PLUGIN_NAME from '@constants/plugin-name';
import type { IPluginOptions } from '../src/plugin';
import ViteSsrBoostPlugin from '../src/plugin';

const aliasesPluginName = `${PLUGIN_NAME}-make-aliases`;
const normalizePluginName = `${PLUGIN_NAME}-normalize-route`;

describe('ViteSsrBoostPlugin', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should return an array of plugins', () => {
    const plugins = ViteSsrBoostPlugin();

    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBeGreaterThan(0);
  });

  it('should include the main plugin in the array', () => {
    const plugins = ViteSsrBoostPlugin();
    const mainPlugin = plugins.find((plugin) => plugin.name === PLUGIN_NAME);

    expect(mainPlugin).toBeDefined();
    expect(mainPlugin!.enforce).to.equal('pre');
    expect(typeof mainPlugin!.config).toBe('function');
  });

  it('should include ViteMakeAliasesPlugin if tsconfigAliases is true', () => {
    const plugins = ViteSsrBoostPlugin({ tsconfigAliases: true });
    const mainPlugin = plugins.find((plugin) => plugin.name === aliasesPluginName);

    expect(mainPlugin).toBeDefined();
  });

  it('should include ViteMakeAliasesPlugin with provided options if tsconfigAliases is an object', () => {
    sandbox.stub(console, 'error');

    const tsconfigAliasesOptions: IPluginOptions['tsconfigAliases'] = {
      root: '/root',
    };

    const plugins = ViteSsrBoostPlugin({ tsconfigAliases: tsconfigAliasesOptions });
    const mainPlugin = plugins.find((plugin) => plugin.name === aliasesPluginName);

    expect(mainPlugin).toBeDefined();
  });

  it('should include ViteNormalizeRouterPlugin', () => {
    const plugins = ViteSsrBoostPlugin();
    const mainPlugin = plugins.find((plugin) => plugin.name === normalizePluginName);

    expect(mainPlugin).toBeDefined();
  });
});
