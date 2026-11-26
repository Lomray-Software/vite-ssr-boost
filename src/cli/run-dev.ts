import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { Plugin, PluginOption } from 'vite';
import ownSignals, { ownSignalsUnlessHandled } from '@cli/helpers/own-signals';
import PLUGIN_NAME from '@constants/plugin-name';
import type { IPluginConfig } from '@helpers/plugin-config';
import printServerInfo from '@helpers/print-server-info';
import type { ILifecycle } from '@node/lifecycle';
import { setCurrentEntrypointName } from '@plugins/handle-custom-entrypoint';
import type { TManagedServer } from '@services/production-config';
import ServerConfig from '@services/server-config';

interface IRunDevParams {
  version: string;
  isHost?: boolean;
  isPrintInfo?: boolean;
  mode?: string;
  port?: number;
  entrypointName?: string;
  // Overrides the plugin's managedServer option.
  server?: TManagedServer;
}

interface IRunDevOut {
  server: Server;
  config: ServerConfig;
  lifecycle?: ILifecycle;
}

/**
 * Flatten a Vite plugin option (nested arrays, promises, falsy entries) into plugin objects.
 */
const flattenPlugins = async (option: PluginOption): Promise<Plugin[]> => {
  const value = await option;

  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return (await Promise.all(value.map(flattenPlugins))).flat();
  }

  return [value as Plugin];
};

/**
 * Read managedServer from the project's Vite config; projects without the plugin keep Express.
 * The config file is only loaded, never resolved, so no plugin hook runs before the chosen server
 * resolves it. A config that fails to load surfaces here instead of silently selecting Express.
 */
const resolveManagedServer = async (mode = 'development'): Promise<TManagedServer> => {
  const { loadConfigFromFile } = await import('vite');
  const loaded = await loadConfigFromFile({ command: 'serve', mode });
  const plugins = await flattenPlugins(loaded?.config.plugins);
  const plugin = plugins.find(({ name }) => name === PLUGIN_NAME) as
    { pluginOptions?: Partial<IPluginConfig> } | undefined;

  return plugin?.pluginOptions?.managedServer ?? 'express';
};

/**
 * Start the node:http dev server with Vite in middleware mode and HMR on the same port.
 */
const runNodeServer = async ({
  version,
  isHost = false,
  isPrintInfo = true,
  mode,
  port,
  entrypointName,
}: IRunDevParams): Promise<IRunDevOut> => {
  const { createDevServer } = await import('@node/dev');
  const app = await createDevServer({ mode, entrypointName, isHost, port });
  const { host, port: resolvedPort } = app.config.getParams();

  if (isHost) {
    // Print the network URL the same way the Express dev server does.
    app.vite.config.server.host = host;
  }

  try {
    await app.listen(resolvedPort, host);
  } catch (error) {
    // a failed bind must not leave Vite watchers and HMR sockets behind
    await app.close();

    throw error;
  }

  if (isPrintInfo) {
    void printServerInfo(app.config, { version, server: app.server });
  }

  return { server: app.server, config: app.config, lifecycle: app.lifecycle };
};

/**
 * Run development server
 */
async function runDev(params: IRunDevParams): Promise<IRunDevOut> {
  const { version, isHost, isPrintInfo, mode, port, entrypointName } = params;

  global.viteBoostStartTime = performance.now();

  if (entrypointName) {
    setCurrentEntrypointName(entrypointName);
  }

  if ((params.server ?? (await resolveManagedServer(mode))) === 'node') {
    const out = await runNodeServer(params);

    ownSignals(out.lifecycle);

    return out;
  }

  const { default: createServer } = await import('@adapters/express/server');
  const config = ServerConfig.init({ isHost, mode, entrypointName }, { port });
  const { run, getLifecycle } = await createServer(config);
  const server = run({ version, isPrintInfo });
  const lifecycle = getLifecycle();

  ownSignalsUnlessHandled(server, lifecycle);

  return { server, config, lifecycle };
}

export default runDev;
