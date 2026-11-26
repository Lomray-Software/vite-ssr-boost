import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import ownSignals from '@cli/helpers/own-signals';
import getPluginConfig from '@helpers/plugin-config';
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
 * Read managedServer from the project's Vite config; projects without the plugin keep Express.
 */
const resolveManagedServer = async (mode?: string): Promise<TManagedServer> => {
  const { resolveConfig } = await import('vite');

  try {
    return getPluginConfig(await resolveConfig({ mode }, 'serve', mode)).managedServer ?? 'express';
  } catch {
    return 'express';
  }
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

  await app.listen(resolvedPort, host);

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

  let out: IRunDevOut;

  if ((params.server ?? (await resolveManagedServer(mode))) === 'node') {
    out = await runNodeServer(params);
  } else {
    const { default: createServer } = await import('@adapters/express/server');
    const config = ServerConfig.init({ isHost, mode, entrypointName }, { port });
    const { run, getLifecycle } = await createServer(config);

    out = { server: run({ version, isPrintInfo }), config, lifecycle: getLifecycle() };
  }

  ownSignals(out.lifecycle);

  return out;
}

export default runDev;
