import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import createServer from '@node/server';
import { setCurrentEntrypointName } from '@plugins/handle-custom-entrypoint';
import ServerConfig from '@services/server-config';

interface IRunDevParams {
  version: string;
  isHost?: boolean;
  isPrintInfo?: boolean;
  mode?: string;
  port?: number;
  entrypointName?: string;
}

interface IRunDevOut {
  server: Server;
  config: ServerConfig;
}

/**
 * Run development server
 */
async function runDev({
  version,
  isHost,
  isPrintInfo,
  mode,
  port,
  entrypointName,
}: IRunDevParams): Promise<IRunDevOut> {
  global.viteBoostStartTime = performance.now();

  if (entrypointName) {
    setCurrentEntrypointName(entrypointName);
  }

  const config = ServerConfig.init(
    { isHost, mode, entrypointName },
    {
      port,
    },
  );
  const { run } = await createServer(config);

  return {
    server: run({ version, isPrintInfo }),
    config,
  };
}

export default runDev;
