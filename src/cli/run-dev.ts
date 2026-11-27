import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { ViteDevServer } from 'vite';
import createDevVite from '@cli/helpers/create-dev-vite';
import ownSignals, { ownSignalsUnlessHandled } from '@cli/helpers/own-signals';
import PLUGIN_NAME from '@constants/plugin-name';
import type { IPluginConfig } from '@helpers/plugin-config';
import printServerInfo from '@helpers/print-server-info';
import rethrowAfterCleanup from '@helpers/rethrow-after-cleanup';
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
 * Read managedServer from a started Vite server; projects without the plugin keep Express.
 */
const readManagedServer = (vite: ViteDevServer): TManagedServer => {
  const plugin = vite.config.plugins.find(({ name }) => name === PLUGIN_NAME) as
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
    return rethrowAfterCleanup(error, app.close, app.config.getLogger());
  }

  if (isPrintInfo) {
    void printServerInfo(app.config, { version, server: app.server });
  }

  return { server: app.server, config: app.config, lifecycle: app.lifecycle };
};

/**
 * Start the node dev server and route signals through its drain.
 */
const startNodeServer = async (params: IRunDevParams): Promise<IRunDevOut> => {
  const out = await runNodeServer(params);

  ownSignals(out.lifecycle);

  return out;
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

  if (params.server === 'node') {
    return startNodeServer(params);
  }

  const config = ServerConfig.init({ isHost, mode, entrypointName }, { port });
  // Without the flag the plugin options decide. The Express server mounts this Vite, so the
  // default start evaluates the config once; Express loads only once it is picked.
  const pick = params.server ? undefined : await createDevVite(config.mode);

  if (pick && readManagedServer(pick) === 'node') {
    await pick.close();

    return startNodeServer(params);
  }

  // The Vite that serves the start: closed here once if anything fails before the server runs.
  let vite = pick;
  let server: Server;
  let lifecycle: ILifecycle | undefined;

  try {
    const { default: createServer } = await import('@adapters/express/server');
    const created = await createServer(config, {}, pick);

    vite = config.getVite();
    server = created.run({ version, isPrintInfo });
    lifecycle = created.getLifecycle();
  } catch (error) {
    return rethrowAfterCleanup(error, () => vite?.close(), config.getLogger());
  }

  ownSignalsUnlessHandled(lifecycle);

  return { server, config, lifecycle };
}

export default runDev;
