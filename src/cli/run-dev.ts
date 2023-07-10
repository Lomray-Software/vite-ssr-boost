import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import createServer from '@node/server';
import ServerConfig from '@services/server-config';

interface IRunDevParams {
  version: string;
  isHost?: boolean;
  isPrintInfo?: boolean;
  mode?: string;
}

interface IRunDevOut {
  server: Server;
  config: ServerConfig;
}

/**
 * Run development server
 */
async function runDev({ version, isHost, isPrintInfo, mode }: IRunDevParams): Promise<IRunDevOut> {
  global.viteBoostStartTime = performance.now();

  const config = ServerConfig.init({ isHost, mode });
  const { run } = await createServer(config);

  return {
    server: run({ version, isPrintInfo }),
    config,
  };
}

export default runDev;
