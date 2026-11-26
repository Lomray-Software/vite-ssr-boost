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

export default ownSignals;
