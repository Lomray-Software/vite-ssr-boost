import type { Server } from 'node:net';
import cliContext from '@constants/cli-context';
import processStop from '@helpers/process-stop';
import type { ILifecycle } from '@node/lifecycle';

let release: (() => void) | undefined;
// Bumped by every selection, so a check an older start left pending does nothing.
let generation = 0;
// Drops the listening listener of a check that has not run yet.
let cancelPending: (() => void) | undefined;

/**
 * Forget the subscription and any pending check of the previous start.
 */
const supersede = (): number => {
  release?.();
  release = undefined;
  cancelPending?.();
  cancelPending = undefined;
  generation += 1;

  return generation;
};

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
  supersede();
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
  const current = supersede();

  if (!lifecycle) {
    return;
  }

  /**
   * Take signals once the server listens, unless a newer start replaced this one.
   */
  const onListening = (): void => {
    cancelPending = undefined;

    setImmediate(() => {
      if (current !== generation) {
        return;
      }

      const isHandled = SIGNALS.some((signal) => process.listenerCount(signal) > 0);

      if (isHandled) {
        return;
      }

      ownSignals(lifecycle);
    });
  };

  server.once('listening', onListening);
  cancelPending = () => {
    server.off('listening', onListening);
  };
};

export { ownSignalsUnlessHandled };

export default ownSignals;
