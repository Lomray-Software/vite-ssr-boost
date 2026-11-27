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

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Express servers before 8.7 left signals to the application, so one with any SIGTERM or SIGINT
 * listener keeps them: a preloaded module, its entry or onServerStarted. The CLI drops its own
 * subscription first, and the check runs once the server listens and the synchronous part of
 * onServerStarted has run.
 */
const ownSignalsUnlessHandled = (server: Server, lifecycle?: ILifecycle): void => {
  release?.();
  release = undefined;

  if (!lifecycle) {
    return;
  }

  server.once('listening', () => {
    setImmediate(() => {
      const isHandled = SIGNALS.some((signal) => process.listenerCount(signal) > 0);

      if (isHandled) {
        return;
      }

      ownSignals(lifecycle);
    });
  });
};

export { ownSignalsUnlessHandled };

export default ownSignals;
