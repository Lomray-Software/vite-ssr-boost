import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import createFocusOnly from '@helpers/create-focus-only';
import createServer from '@node/server';
import type { IBuildParams } from '@services/build';
import ServerConfig from '@services/server-config';

interface IRunProdParams {
  version: string;
  port?: number;
  isHost?: boolean;
  isPrintInfo?: boolean;
  focusOnly?: IBuildParams['focusOnly'];
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

  const config = ServerConfig.init(
    {
      isHost,
      isProd: true,
      isOnlyClient: createFocusOnly(focusOnly).isOnlyClient(),
      isModulePreload: modulePreload,
    },
    { port, root: buildDir },
  );
  const { run } = await createServer(config);

  return {
    server: run({ version, isPrintInfo }),
    config,
  };
}

export default runProd;
