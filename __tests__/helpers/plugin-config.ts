import { expect } from 'chai';
import sinon from 'sinon';
import type { ResolvedConfig } from 'vite';
import { afterEach, describe, it } from 'vitest';
import CliActions from '@constants/cli-actions';
import PLUGIN_NAME from '@constants/plugin-name';
import type { IPluginConfig } from '@helpers/plugin-config';
import getPluginConfig from '@helpers/plugin-config';

describe('getPluginConfig', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should return plugin config when plugin is present in the VITE config', () => {
    const pluginConfig = {
      pluginPath: '/path/to/plugin',
      action: CliActions.build,
      isDev: false,
    } as IPluginConfig;

    const viteConfig = {
      plugins: [
        {
          name: PLUGIN_NAME,
          pluginOptions: pluginConfig,
        },
      ],
    } as unknown as ResolvedConfig;

    const result = getPluginConfig(viteConfig);

    expect(result).to.deep.equal(pluginConfig);
  });

  it('should throw an error when plugin is not present in the VITE config', () => {
    const viteConfig = {
      plugins: [],
    };

    const errorStub = sandbox.stub(console, 'error');

    try {
      expect(() => getPluginConfig(viteConfig as unknown as ResolvedConfig)).to.throw(
        `Failed to get to plugin config. Make sure you add the plugin '${PLUGIN_NAME}' to the VITE config.`,
      );
    } finally {
      errorStub.restore();
    }
  });

  it('should throw an error when pluginOptions is not present in the plugin config', () => {
    const viteConfig = {
      plugins: [
        {
          name: PLUGIN_NAME,
        },
      ],
    };

    const errorStub = sandbox.stub(console, 'error');

    try {
      expect(() => getPluginConfig(viteConfig as unknown as ResolvedConfig)).to.throw(
        `Failed to get to plugin config. Make sure you add the plugin '${PLUGIN_NAME}' to the VITE config.`,
      );
    } finally {
      errorStub.restore();
    }
  });
});
