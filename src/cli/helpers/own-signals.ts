import type { Server } from 'node:net';
import cliContext from '@constants/cli-context';
import processStop from '@helpers/process-stop';
import type { ILifecycle } from '@node/lifecycle';

let release: (() => void) | undefined;

/**
 * Mark the CLI as exiting so a restart shortcut in flight does not boot a new server.
 */
const markExiting = (): void => {
  cliContext.isExiting = true;
};

/**
 * Route SIGTERM and SIGINT to the current managed server; a restart replaces the previous subscription.
 */
const ownSignals = (lifecycle?: ILifecycle): void => {
  release?.();
  release = lifecycle?.handleSignals({ onSignal: markExiting, onExit: processStop });
};

/**
 * Express servers before 8.7 left signals to the application, so one that already subscribed in its
 * entry or in onServerStarted keeps them. The check runs once the server listens and the
 * synchronous part of onServerStarted has run.
 */
const ownSignalsUnlessHandled = (server: Server, lifecycle?: ILifecycle): void => {
  release?.();
  release = undefined;

  if (!lifecycle) {
    return;
  }

  server.once('listening', () => {
    setImmediate(() => {
      if (process.listenerCount('SIGTERM') > 0 || process.listenerCount('SIGINT') > 0) {
        return;
      }

      ownSignals(lifecycle);
    });
  });
};

export { ownSignalsUnlessHandled };

export default ownSignals;
