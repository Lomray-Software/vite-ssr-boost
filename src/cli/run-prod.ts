import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import createServer from '@adapters/express/server';
import createFocusOnly from '@helpers/create-focus-only';
import type { IBuildParams } from '@services/build';
import loadProductionConfig from '@services/production-config';
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
}

interface IRunProdOut {
  server: Server;
  config: ServerConfig;
}

/**
 * Run production server
 */
async function runProd({
  version,
  isHost,
  isPrintInfo,
  port,
  buildDir,
  focusOnly,
  modulePreload = false,
}: IRunProdParams): Promise<IRunProdOut> {
  if (!global.viteBoostStartTime) {
    global.viteBoostStartTime = performance.now();
  }

  const { root, base, publicDir, indexFile, serverFile, mode } =
    loadProductionConfig(buildDir) ?? {};
  const config = ServerConfig.init(
    {
      isHost,
      isProd: true,
      isOnlyClient: createFocusOnly(focusOnly).isOnlyClient(),
      isModulePreload: modulePreload,
      mode,
    },
    {
      port,
      root: root ?? buildDir,
      ...(base === undefined ? {} : { base, publicDir, indexFile, serverFile }),
    },
  );
  const { run } = await createServer(config);

  return {
    server: run({ version, isPrintInfo }),
    config,
  };
}

export default runProd;
