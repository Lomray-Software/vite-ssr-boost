// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import ownSignals from '@cli/helpers/own-signals';
import runDev from '@cli/run-dev';

const { createDevServerMock } = vi.hoisted(() => ({ createDevServerMock: vi.fn() }));

vi.mock('@node/dev', () => ({ createDevServer: createDevServerMock }));

interface IAppDouble {
  close: ReturnType<typeof vi.fn>;
  listen: ReturnType<typeof vi.fn>;
  config: { getParams: () => { host: string; port: number }; getLogger: () => unknown };
  vite: { config: { server: { host?: string } } };
}

/**
 * A started node dev app whose steps the test replaces.
 */
const createApp = (overrides: Partial<IAppDouble> = {}): IAppDouble => ({
  close: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(null),
  config: { getParams: () => ({ host: '0.0.0.0', port: 0 }), getLogger: () => ({ error: vi.fn() }) },
  vite: { config: { server: {} } },
  ...overrides,
});

afterEach(() => {
  ownSignals(undefined);
  vi.clearAllMocks();
});

describe('ssr-boost dev node start cleanup', () => {
  it('should close the app once and keep the error when reading the params throws', async () => {
    const failure = new Error('params failed');
    const app = createApp({
      config: {
        getParams: () => {
          throw failure;
        },
        getLogger: () => ({ error: vi.fn() }),
      },
    });

    createDevServerMock.mockResolvedValue(app);

    await expect(runDev({ version: '1', isPrintInfo: false, server: 'node' })).rejects.toBe(failure);
    expect(app.close).toHaveBeenCalledOnce();
    expect(app.listen).not.toHaveBeenCalled();
  });

  it('should close the app once and keep the error when setting the host throws', async () => {
    const app = createApp({ vite: { config: { server: Object.freeze({}) } } });

    createDevServerMock.mockResolvedValue(app);

    await expect(
      runDev({ version: '1', isPrintInfo: false, isHost: true, server: 'node' }),
    ).rejects.toThrow(TypeError);
    expect(app.close).toHaveBeenCalledOnce();
    expect(app.listen).not.toHaveBeenCalled();
  });

  it('should close the app once and keep the bind error when the logger cannot be read', async () => {
    const failure = new Error('bind failed');
    const app = createApp({
      listen: vi.fn().mockRejectedValue(failure),
      config: {
        getParams: () => ({ host: '0.0.0.0', port: 0 }),
        getLogger: () => {
          throw new Error('logger failed');
        },
      },
    });

    createDevServerMock.mockResolvedValue(app);

    await expect(runDev({ version: '1', isPrintInfo: false, server: 'node' })).rejects.toBe(failure);
    expect(app.close).toHaveBeenCalledOnce();
  });
});
