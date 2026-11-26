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
 * Record the signal listeners present before the application loads, so they are not taken as
 * its own.
 */
const snapshotSignalListeners = (): ReadonlySet<unknown> =>
  new Set(SIGNALS.flatMap((signal) => process.listeners(signal)));

/**
 * Express servers before 8.7 left signals to the application, so one that already subscribed in its
 * entry or in onServerStarted keeps them. The check runs once the server listens and the
 * synchronous part of onServerStarted has run; listeners in `before` were there earlier and do
 * not count.
 */
const ownSignalsUnlessHandled = (
  server: Server,
  lifecycle?: ILifecycle,
  before: ReadonlySet<unknown> = new Set(),
): void => {
  release?.();
  release = undefined;

  if (!lifecycle) {
    return;
  }

  server.once('listening', () => {
    setImmediate(() => {
      const isHandled = SIGNALS.some((signal) =>
        process.listeners(signal).some((listener) => !before.has(listener)),
      );

      if (isHandled) {
        return;
      }

      ownSignals(lifecycle);
    });
  });
};

export { ownSignalsUnlessHandled, snapshotSignalListeners };

export default ownSignals;
