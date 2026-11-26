import { afterEach, describe, expect, it, vi } from 'vitest';
import ownSignals from '@cli/helpers/own-signals';

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

    expect(lifecycle.handleSignals).toHaveBeenCalledWith({ onExit: processStopMock });
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
