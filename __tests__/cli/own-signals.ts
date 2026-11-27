import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import ownSignals, { ownSignalsUnlessHandled } from '@cli/helpers/own-signals';
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

  it('takes signals when no listener is present once the server listens', async () => {
    const server = new EventEmitter();
    const { lifecycle } = createLifecycle();

    ownSignalsUnlessHandled(server as never, lifecycle as never);
    await listen(server);

    expect(lifecycle.handleSignals).toHaveBeenCalledOnce();
  });

  it('leaves signals to a listener present before the server loaded (a preload)', async () => {
    addSigterm();

    const server = new EventEmitter();
    const { lifecycle } = createLifecycle();

    ownSignalsUnlessHandled(server as never, lifecycle as never);
    await listen(server);

    expect(lifecycle.handleSignals).not.toHaveBeenCalled();
  });

  it('leaves signals to an application that subscribed while the server started', async () => {
    const server = new EventEmitter();
    const { lifecycle } = createLifecycle();

    ownSignalsUnlessHandled(server as never, lifecycle as never);
    addSigterm();
    await listen(server);

    expect(lifecycle.handleSignals).not.toHaveBeenCalled();
  });

  it('does not count its own previous subscription after a restart', async () => {
    const first = new EventEmitter();
    const second = new EventEmitter();
    const sigterm = vi.fn();
    const { lifecycle: firstLifecycle } = createLifecycle();
    // A real subscription, so the restart must remove it before it counts listeners.
    const lifecycle = {
      handleSignals: vi.fn(() => {
        process.on('SIGTERM', sigterm);

        return () => process.off('SIGTERM', sigterm);
      }),
    };

    ownSignalsUnlessHandled(first as never, lifecycle as never);
    await listen(first);
    expect(process.listeners('SIGTERM')).toContain(sigterm);

    ownSignalsUnlessHandled(second as never, firstLifecycle as never);
    await listen(second);

    expect(firstLifecycle.handleSignals).toHaveBeenCalledOnce();
  });

  /**
   * Lifecycle double whose subscription adds a real SIGTERM listener.
   */
  const createSubscribingLifecycle = () => {
    const sigterm = vi.fn();
    const lifecycle = {
      handleSignals: vi.fn(() => {
        process.on('SIGTERM', sigterm);

        return () => process.off('SIGTERM', sigterm);
      }),
    };

    added.push(() => process.off('SIGTERM', sigterm));

    return { lifecycle, sigterm };
  };

  it('drops a pending check of a start a newer one replaced', async () => {
    const first = new EventEmitter();
    const second = new EventEmitter();
    const older = createSubscribingLifecycle();
    const newer = createSubscribingLifecycle();

    ownSignalsUnlessHandled(first as never, older.lifecycle as never);
    // The older check is queued but has not run when the newer start is selected.
    first.emit('listening');
    ownSignalsUnlessHandled(second as never, newer.lifecycle as never);
    await listen(second);
    await new Promise((resolve) => setImmediate(resolve));

    expect(older.lifecycle.handleSignals).not.toHaveBeenCalled();
    expect(newer.lifecycle.handleSignals).toHaveBeenCalledOnce();
    expect(process.listeners('SIGTERM')).toEqual([newer.sigterm]);
  });

  it('removes the listening listener of a start replaced before it listened', async () => {
    const first = new EventEmitter();
    const second = new EventEmitter();
    const older = createSubscribingLifecycle();
    const newer = createSubscribingLifecycle();

    ownSignalsUnlessHandled(first as never, older.lifecycle as never);
    ownSignalsUnlessHandled(second as never, newer.lifecycle as never);

    expect(first.listenerCount('listening')).toBe(0);

    await listen(second);
    await listen(first);

    expect(older.lifecycle.handleSignals).not.toHaveBeenCalled();
    expect(newer.lifecycle.handleSignals).toHaveBeenCalledOnce();
  });

  it('drops a pending check when the node server takes signals directly', async () => {
    const server = new EventEmitter();
    const older = createSubscribingLifecycle();
    const { lifecycle } = createLifecycle();

    ownSignalsUnlessHandled(server as never, older.lifecycle as never);
    server.emit('listening');
    ownSignals(lifecycle as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(older.lifecycle.handleSignals).not.toHaveBeenCalled();
    expect(lifecycle.handleSignals).toHaveBeenCalledOnce();
  });

  it('still yields after a restart to an application listener the restart kept', async () => {
    addSigterm();

    const first = new EventEmitter();
    const second = new EventEmitter();
    const { lifecycle } = createLifecycle();

    ownSignalsUnlessHandled(first as never, lifecycle as never);
    await listen(first);
    ownSignalsUnlessHandled(second as never, lifecycle as never);
    await listen(second);

    expect(lifecycle.handleSignals).not.toHaveBeenCalled();
  });
});
