import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, afterEach } from 'vitest';
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

    expect(plugins).to.be.an('array');
    expect(plugins).to.have.length.above(0);
  });

  it('should include the main plugin in the array', () => {
    const plugins = ViteSsrBoostPlugin();
    const mainPlugin = plugins.find((plugin) => plugin.name === PLUGIN_NAME);

    expect(mainPlugin).to.exist;
    expect(mainPlugin!.enforce).to.equal('pre');
    expect(mainPlugin!.config).to.be.a('function');
  });

  it('should include ViteMakeAliasesPlugin if tsconfigAliases is true', () => {
    const plugins = ViteSsrBoostPlugin({ tsconfigAliases: true });
    const mainPlugin = plugins.find((plugin) => plugin.name === aliasesPluginName);

    expect(mainPlugin).to.exist;
  });

  it('should include ViteMakeAliasesPlugin with provided options if tsconfigAliases is an object', () => {
    sandbox.stub(console, 'error');

    const tsconfigAliasesOptions: IPluginOptions['tsconfigAliases'] = {
      root: '/root',
    };

    const plugins = ViteSsrBoostPlugin({ tsconfigAliases: tsconfigAliasesOptions });
    const mainPlugin = plugins.find((plugin) => plugin.name === aliasesPluginName);

    expect(mainPlugin).to.exist;
  });

  it('should include ViteNormalizeRouterPlugin', () => {
    const plugins = ViteSsrBoostPlugin();
    const mainPlugin = plugins.find((plugin) => plugin.name === normalizePluginName);

    expect(mainPlugin).to.exist;
  });
});
