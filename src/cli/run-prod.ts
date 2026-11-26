import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import ownSignals from '@cli/helpers/own-signals';
import createFocusOnly from '@helpers/create-focus-only';
import printServerInfo from '@helpers/print-server-info';
import type { ILifecycle } from '@node/lifecycle';
import type { IBuildParams } from '@services/build';
import loadProductionConfig from '@services/production-config';
import type { TManagedServer } from '@services/production-config';
import ServerConfig from '@services/server-config';

interface IRunProdParams {
  version: string;
  port?: number;
  isHost?: boolean;
  isPrintInfo?: boolean;
  focusOnly?: NonNullable<IBuildParams['focusOnly']>;
  mode?: string;
  modulePreload?: boolean;
  buildDir?: string;
  // Overrides the server persisted by the build; express when neither is set.
  server?: TManagedServer;
}

interface IRunProdOut {
  server: Server;
  config: ServerConfig;
  lifecycle?: ILifecycle;
}

/**
 * Start the node:http production server; it needs neither Express nor Vite.
 */
const runNodeServer = async (
  config: ServerConfig,
  { version, isPrintInfo = true, buildDir }: IRunProdParams,
): Promise<IRunProdOut> => {
  const { createProductionServer } = await import('@node/production');
  const { port, host, isSPA } = config.getParams();
  const { server, lifecycle, listen } = await createProductionServer({
    buildDir,
    modulePreload: config.isModulePreload,
    isSPA,
    // Express compresses by default, so the managed node server does too.
    compression: true,
    logger: config.getLogger(),
  });

  await listen(port, host);

  if (isPrintInfo) {
    void printServerInfo(config, { version, server });
  }

  return { server, config, lifecycle };
};

/**
 * Run production server
 */
async function runProd(params: IRunProdParams): Promise<IRunProdOut> {
  const { version, isHost, isPrintInfo, port, buildDir, focusOnly } = params;

  if (!global.viteBoostStartTime) {
    global.viteBoostStartTime = performance.now();
  }

  const { root, base, publicDir, indexFile, serverFile, mode, managedServer } =
    loadProductionConfig(buildDir) ?? {};
  const config = ServerConfig.init(
    {
      isHost,
      isProd: true,
      isOnlyClient: createFocusOnly(focusOnly).isOnlyClient(),
      isModulePreload: params.modulePreload ?? false,
      mode,
    },
    {
      port,
      root: root ?? buildDir,
      ...(base === undefined ? {} : { base, publicDir, indexFile, serverFile }),
    },
  );
  let out: IRunProdOut;

  if ((params.server ?? managedServer ?? 'express') === 'node') {
    out = await runNodeServer(config, params);
  } else {
    // Imported on demand: express and compression are optional for node server builds.
    const { default: createServer } = await import('@adapters/express/server');
    const { run, getLifecycle } = await createServer(config);

    out = { server: run({ version, isPrintInfo }), config, lifecycle: getLifecycle() };
  }

  ownSignals(out.lifecycle);

  return out;
}

export default runProd;
