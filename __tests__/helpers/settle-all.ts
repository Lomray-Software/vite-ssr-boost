import { describe, expect, it, vi } from 'vitest';
import settleAll from '@helpers/settle-all';

describe('settleAll', () => {
  it('should resolve once every task settled', async () => {
    const first = vi.fn(() => Promise.resolve());
    const second = vi.fn(() => undefined);

    await expect(settleAll(first, second)).resolves.toBeUndefined();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('should run the later task when an earlier one throws synchronously', async () => {
    const failure = new Error('sync failure');
    let isSecondDone = false;

    await expect(
      settleAll(
        () => {
          throw failure;
        },
        async () => {
          await Promise.resolve();
          isSecondDone = true;
        },
      ),
    ).rejects.toBe(failure);
    expect(isSecondDone).toBe(true);
  });

  it('should throw the first failure in task order', async () => {
    const first = new Error('first');
    const second = new Error('second');

    await expect(
      settleAll(
        () => new Promise((_resolve, reject) => setTimeout(() => reject(first), 5)),
        () => Promise.reject(second),
      ),
    ).rejects.toBe(first);
  });
});
