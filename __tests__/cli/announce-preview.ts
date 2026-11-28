import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import announcePreview from '@cli/helpers/announce-preview';

describe('cli/helpers/announce-preview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should announce preview mode after the current readiness output', () => {
    const info = vi.fn();

    announcePreview({ getLogger: () => ({ info }) } as never);

    expect(info).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toContain('Running preview mode');
  });

  it('should announce once when the logger write returns false', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = vi.fn(() => false);

    announcePreview({ getLogger: () => ({ info }) } as never);
    vi.runAllTimers();

    expect(info).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('should keep the preview running when the logger cannot be read', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    announcePreview({
      getLogger: () => {
        throw new Error('no logger');
      },
    } as never);

    expect(() => vi.runAllTimers()).not.toThrow();
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0][0]).toContain('Running preview mode');
  });
});
