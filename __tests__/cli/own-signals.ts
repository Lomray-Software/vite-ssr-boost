import { afterEach, describe, expect, it, vi } from 'vitest';
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
   * Subscribe a listener to a signal for the rest of one test.
   */
  const addListener = (signal: NodeJS.Signals = 'SIGTERM'): (() => void) => {
    const listener = vi.fn();
    const remove = () => process.off(signal, listener);

    process.on(signal, listener);
    added.push(remove);

    return remove;
  };

  /**
   * Lifecycle double whose subscription adds real listeners that honour shouldHandle.
   */
  const createSubscribingLifecycle = () => {
    const drained = vi.fn();
    const lifecycle = {
      handleSignals: vi.fn(
        ({
          onSignal,
          onExit,
          shouldHandle,
        }: {
          onSignal: (signal: NodeJS.Signals) => void;
          onExit: (code: number) => void;
          shouldHandle?: (signal: NodeJS.Signals) => boolean;
        }) => {
          const listeners = (['SIGTERM', 'SIGINT'] as const).map((signal) => {
            const listener = () => {
              if (shouldHandle && !shouldHandle(signal)) {
                return;
              }

              onSignal(signal);
              drained(signal);
              onExit(0);
            };

            // As the lifecycle does: ahead of listeners already present.
            process.prependListener(signal, listener);

            return [signal, listener] as const;
          });
          const release = (): void => {
            listeners.forEach(([signal, listener]) => process.off(signal, listener));
          };

          added.push(release);

          return release;
        },
      ),
    };

    return { lifecycle, drained };
  };

  afterEach(() => {
    ownSignals();
    added.splice(0).forEach((remove) => remove());
    processStopMock.mockClear();
    cliContext.isExiting = undefined;
  });

  it('drains and exits on a signal when nothing else listens', () => {
    const { lifecycle, drained } = createSubscribingLifecycle();

    ownSignalsUnlessHandled(lifecycle as never);
    process.emit('SIGTERM');

    expect(drained).toHaveBeenCalledWith('SIGTERM');
    expect(processStopMock).toHaveBeenCalledWith(0);
    expect(cliContext.isExiting).toBe(true);
  });

  it('leaves a signal to a listener present before the server loaded (a preload)', () => {
    addListener();

    const { lifecycle, drained } = createSubscribingLifecycle();

    ownSignalsUnlessHandled(lifecycle as never);
    process.emit('SIGTERM');

    expect(drained).not.toHaveBeenCalled();
    expect(processStopMock).not.toHaveBeenCalled();
    expect(cliContext.isExiting).toBeUndefined();
  });

  it('leaves a signal to an application that subscribed after an await', async () => {
    const { lifecycle, drained } = createSubscribingLifecycle();

    ownSignalsUnlessHandled(lifecycle as never);
    await new Promise((resolve) => setTimeout(resolve, 5));
    addListener();
    process.emit('SIGTERM');

    expect(drained).not.toHaveBeenCalled();
    expect(processStopMock).not.toHaveBeenCalled();
    expect(cliContext.isExiting).toBeUndefined();
  });

  it('leaves a signal to an application that subscribed with process.once', () => {
    const appListener = vi.fn();

    process.once('SIGTERM', appListener);
    added.push(() => process.off('SIGTERM', appListener));

    const { lifecycle, drained } = createSubscribingLifecycle();

    ownSignalsUnlessHandled(lifecycle as never);
    process.emit('SIGTERM');

    expect(appListener).toHaveBeenCalledOnce();
    expect(drained).not.toHaveBeenCalled();
    expect(processStopMock).not.toHaveBeenCalled();
  });

  it('drains a later signal once the application process.once listener is gone', () => {
    const appListener = vi.fn();

    process.once('SIGTERM', appListener);
    added.push(() => process.off('SIGTERM', appListener));

    const { lifecycle, drained } = createSubscribingLifecycle();

    ownSignalsUnlessHandled(lifecycle as never);
    process.emit('SIGTERM');
    process.emit('SIGTERM');

    expect(appListener).toHaveBeenCalledOnce();
    expect(drained).toHaveBeenCalledOnce();
    expect(processStopMock).toHaveBeenCalledWith(0);
  });

  it('decides each signal on its own when it arrives', () => {
    const removeSigint = addListener('SIGINT');
    const { lifecycle, drained } = createSubscribingLifecycle();

    ownSignalsUnlessHandled(lifecycle as never);
    process.emit('SIGINT');
    expect(drained).not.toHaveBeenCalled();

    process.emit('SIGTERM');
    expect(drained).toHaveBeenCalledWith('SIGTERM');

    removeSigint();
    process.emit('SIGINT');
    expect(drained).toHaveBeenCalledWith('SIGINT');
  });

  it('releases and does not count its previous subscription after a restart', () => {
    const older = createSubscribingLifecycle();
    const newer = createSubscribingLifecycle();

    ownSignalsUnlessHandled(older.lifecycle as never);
    ownSignalsUnlessHandled(newer.lifecycle as never);

    expect(process.listenerCount('SIGTERM')).toBe(1);

    process.emit('SIGTERM');

    expect(older.drained).not.toHaveBeenCalled();
    expect(newer.drained).toHaveBeenCalledOnce();
  });

  it('still yields after a restart to an application listener the restart kept', () => {
    addListener();

    const older = createSubscribingLifecycle();
    const newer = createSubscribingLifecycle();

    ownSignalsUnlessHandled(older.lifecycle as never);
    ownSignalsUnlessHandled(newer.lifecycle as never);
    process.emit('SIGTERM');

    expect(older.drained).not.toHaveBeenCalled();
    expect(newer.drained).not.toHaveBeenCalled();
  });

  it('releases an Express subscription when the node server takes signals directly', () => {
    const older = createSubscribingLifecycle();
    const { lifecycle } = createLifecycle();

    ownSignalsUnlessHandled(older.lifecycle as never);
    ownSignals(lifecycle as never);

    expect(process.listenerCount('SIGTERM')).toBe(0);
    expect(lifecycle.handleSignals).toHaveBeenCalledWith(
      expect.not.objectContaining({ shouldHandle: expect.anything() }),
    );
  });
});
