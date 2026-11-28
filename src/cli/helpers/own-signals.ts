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
 * Subscribe the current managed server to signals; a restart replaces the previous subscription.
 */
const subscribe = (
  lifecycle?: ILifecycle,
  shouldHandle?: (signal: NodeJS.Signals) => boolean,
): void => {
  release?.();
  release = lifecycle?.handleSignals({ onSignal: markExiting, onExit: processStop, shouldHandle });
};

/**
 * Route SIGTERM and SIGINT to the current managed server.
 */
const ownSignals = (lifecycle?: ILifecycle): void => {
  subscribe(lifecycle);
};

/**
 * Whether only the CLI listens to this signal: its own subscription adds exactly one listener.
 */
const isUnhandledByApp = (signal: NodeJS.Signals): boolean => process.listenerCount(signal) <= 1;

/**
 * Express servers before 8.7 left signals to the application, so a signal the application listens
 * to stays its own: a listener from a preloaded module, its entry or onServerStarted, however late
 * it subscribed. The check runs when the signal arrives, so the CLI drains only when nothing else
 * listens to that signal at that moment.
 */
const ownSignalsUnlessHandled = (lifecycle?: ILifecycle): void => {
  subscribe(lifecycle, isUnhandledByApp);
};

export { ownSignalsUnlessHandled };

export default ownSignals;
