import type { Server } from 'node:net';
import type ServerConfig from '@services/server-config';

export interface ICliContext {
  isProd?: boolean;
  server?: Server;
  config?: ServerConfig;
  reboot?: (isPrintInfo?: boolean) => Promise<void>; // reboot dev server
}

/**
 * Share CLI context
 */
const cliContext: ICliContext = {
  isProd: false,
};

export default cliContext;
