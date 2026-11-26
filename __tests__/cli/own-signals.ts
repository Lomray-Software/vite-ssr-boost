import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import ownSignals, {
  ownSignalsUnlessHandled,
  snapshotSignalListeners,
} from '@cli/helpers/own-signals';
import cliContext from '@constants/cli-context';

const { processStopMock } = vi.hoisted(() => ({ processStopMock: vi.fn() }));

vi.mock('@helpers/process-stop', () => ({ default: processStopMock }));

/**
 * Lifecycle double that records its signal subscription.
 */
const createLifecycle = () => {
  const release = vi.fn();

  return { release, lifecycle: { handleSignals: vi.fn(() => release) } };
};

describe('ownSignals', () => {
  afterEach(() => {
    ownSignals();
  });

  it('routes signals to the lifecycle and exits through processStop', () => {
    const { lifecycle } = createLifecycle();

    ownSignals(lifecycle as never);

    expect(lifecycle.handleSignals).toHaveBeenCalledWith(
      expect.objectContaining({ onExit: processStopMock }),
    );
  });

  it('marks the CLI as exiting when a signal arrives', () => {
    const { lifecycle } = createLifecycle();

    ownSignals(lifecycle as never);

    const [[{ onSignal }]] = lifecycle.handleSignals.mock.calls as unknown as [
      [{ onSignal: (signal: string) => void }],
    ];

    onSignal('SIGTERM');

    expect(cliContext.isExiting).toBe(true);
    cliContext.isExiting = undefined;
  });

  it('releases the previous subscription when a restart brings a new server', () => {
    const first = createLifecycle();
    const second = createLifecycle();

    ownSignals(first.lifecycle as never);
    ownSignals(second.lifecycle as never);

    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.release).not.toHaveBeenCalled();

    ownSignals();

    expect(second.release).toHaveBeenCalledTimes(1);
  });
});

describe('ownSignalsUnlessHandled', () => {
  const added: (() => void)[] = [];

  /**
   * Subscribe a listener to SIGTERM for the duration of one test.
   */
  const addSigterm = (): void => {
    const listener = vi.fn();

    process.on('SIGTERM', listener);
    added.push(() => process.off('SIGTERM', listener));
  };

  /**
   * Emit listening on a server double and wait for the deferred check.
   */
  const listen = async (server: EventEmitter): Promise<void> => {
    server.emit('listening');
    await new Promise((resolve) => setImmediate(resolve));
  };

  afterEach(() => {
    added.splice(0).forEach((remove) => remove());
    ownSignals();
  });

  it('ignores listeners that were there before the server loaded', async () => {
    addSigterm();

    const before = snapshotSignalListeners();
    const server = new EventEmitter();
    const { lifecycle } = createLifecycle();

    ownSignalsUnlessHandled(server as never, lifecycle as never, before);
    await listen(server);

    expect(lifecycle.handleSignals).toHaveBeenCalledOnce();
  });

  it('leaves signals to an application that subscribed after the snapshot', async () => {
    const before = snapshotSignalListeners();

    addSigterm();

    const server = new EventEmitter();
    const { lifecycle } = createLifecycle();

    ownSignalsUnlessHandled(server as never, lifecycle as never, before);
    await listen(server);

    expect(lifecycle.handleSignals).not.toHaveBeenCalled();
  });

  it('counts every listener when no snapshot is given', async () => {
    addSigterm();

    const server = new EventEmitter();
    const { lifecycle } = createLifecycle();

    ownSignalsUnlessHandled(server as never, lifecycle as never);
    await listen(server);

    expect(lifecycle.handleSignals).not.toHaveBeenCalled();
  });
});
