import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import createServer from '@node/server';
import ServerConfig from '@services/server-config';

interface IRunProdParams {
  version: string;
  port?: number;
  isHost?: boolean;
  isPrintInfo?: boolean;
  onlyClient?: boolean; // SPA mode
  mode?: string;
  modulePreload?: boolean;
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
  onlyClient = false,
  modulePreload = false,
}: IRunProdParams): Promise<IRunProdOut> {
  if (!global.viteBoostStartTime) {
    global.viteBoostStartTime = performance.now();
  }

  const config = ServerConfig.init(
    { isHost, isProd: true, isOnlyClient: onlyClient, isModulePreload: modulePreload },
    { port },
  );
  const { run } = await createServer(config);

  return {
    server: run({ version, isPrintInfo }),
    config,
  };
}

export default runProd;
