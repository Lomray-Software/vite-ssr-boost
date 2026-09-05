import { performance } from 'node:perf_hooks';
import type { ICreateServerOut } from '@adapters/express/server';
import createServer from '@adapters/express/server';
import printServerInfo from '@helpers/print-server-info';
import ServerConfig from '@services/server-config';

interface IRunServerlessParams {
  version: string;
  modulePreload?: boolean;
}

/**
 * Run serverless
 */
async function runServerless({
  version,
  modulePreload = false,
}: IRunServerlessParams): Promise<ICreateServerOut['app']> {
  if (!global.viteBoostStartTime) {
    global.viteBoostStartTime = performance.now();
  }

  const config = ServerConfig.init({
    isProd: true,
    isOnlyClient: false,
    isModulePreload: modulePreload,
  });

  const { app } = await createServer(config);

  void printServerInfo(config, { version });

  return app;
}

export default runServerless;
