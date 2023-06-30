import type { ResolvedConfig } from 'vite';
import type CliActions from '@constants/cli-actions';
import PLUGIN_NAME from '@constants/plugin-name';
import type { IPluginOptions } from '../plugin';

export interface IPluginConfig extends Required<IPluginOptions> {
  pluginPath: string;
  action: CliActions;
  isDev: boolean;
}

/**
 * Get plugin config from vite config
 */
function getPluginConfig(viteConfig: ResolvedConfig): IPluginConfig {
  const pluginOptions = viteConfig.plugins.find((plugin) => plugin.name === PLUGIN_NAME)?.[
    'pluginOptions'
  ] as unknown as IPluginConfig;

  if (!pluginOptions) {
    throw new Error(
      `Failed to get to plugin config. Make sure you add the plugin '${PLUGIN_NAME}' to the VITE config.`,
    );
  }

  return pluginOptions;
}

export default getPluginConfig;
