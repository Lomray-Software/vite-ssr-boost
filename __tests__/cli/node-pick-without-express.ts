// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import runDev from '@cli/run-dev';
import PLUGIN_NAME from '@constants/plugin-name';
import ServerConfig from '@services/server-config';

const { createDevViteMock, createDevServerMock } = vi.hoisted(() => ({
  createDevViteMock: vi.fn(),
  createDevServerMock: vi.fn(),
}));

// A project on the node server may not have Express installed: loading it fails the start.
vi.mock('express', () => {
  throw new Error('express loaded');
});
vi.mock('compression', () => {
  throw new Error('compression loaded');
});
vi.mock('@adapters/express/server', () => {
  throw new Error('express adapter loaded');
});
vi.mock('@cli/helpers/create-dev-vite', () => ({ default: createDevViteMock }));
vi.mock('@node/dev', () => ({ createDevServer: createDevServerMock }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('ssr-boost dev node pick', () => {
  it('should start the node server without loading Express', async () => {
    const close = vi.fn().mockResolvedValue(undefined);

    createDevViteMock.mockResolvedValue({
      config: { plugins: [{ name: PLUGIN_NAME, pluginOptions: { managedServer: 'node' } }] },
      close,
    });
    createDevServerMock.mockRejectedValue(new Error('node server started'));

    await expect(runDev({ version: '1', isPrintInfo: false, mode: 'development' })).rejects.toThrow(
      'node server started',
    );
    expect(close).toHaveBeenCalledOnce();
    expect(createDevServerMock).toHaveBeenCalledOnce();
  });

  it('should close the picking Vite once when reading the server selection throws', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const failure = new Error('selection getter failed');
    const pluginOptions = {};

    Object.defineProperty(pluginOptions, 'managedServer', {
      get: () => {
        throw failure;
      },
    });
    createDevViteMock.mockResolvedValue({
      config: { plugins: [{ name: PLUGIN_NAME, pluginOptions }] },
      close,
    });

    await expect(runDev({ version: '1', isPrintInfo: false, mode: 'development' })).rejects.toBe(
      failure,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(createDevServerMock).not.toHaveBeenCalled();
  });

  it('should fail an Express pick on the missing Express and close the picking Vite', async () => {
    const close = vi.fn().mockResolvedValue(undefined);

    createDevViteMock.mockResolvedValue({
      config: { plugins: [{ name: PLUGIN_NAME, pluginOptions: {} }] },
      close,
    });

    const error = (await runDev({ version: '1', isPrintInfo: false, mode: 'development' }).catch(
      (reason: unknown) => reason,
    )) as Error & { cause?: Error };

    // Vitest may wrap a throwing mock factory; then the cause is the factory's own error.
    expect((error.cause ?? error).message).toMatch(/express adapter loaded/);
    expect(close).toHaveBeenCalledOnce();
    expect(createDevServerMock).not.toHaveBeenCalled();
  });

  it.each([
    ['reading the server selection', true, /selection getter failed/],
    ['loading Express', false, /express adapter loaded/],
  ])(
    'should keep the error of %s and close the picking Vite when the logger cannot be read',
    async (_, isBrokenSelection, message) => {
      const close = vi.fn().mockResolvedValue(undefined);
      const pluginOptions = {};

      if (isBrokenSelection) {
        Object.defineProperty(pluginOptions, 'managedServer', {
          get: () => {
            throw new Error('selection getter failed');
          },
        });
      }
      vi.spyOn(ServerConfig.prototype, 'getLogger').mockImplementation(() => {
        throw new Error('logger failed');
      });
      createDevViteMock.mockResolvedValue({
        config: { plugins: [{ name: PLUGIN_NAME, pluginOptions }] },
        close,
      });

      const error = (await runDev({ version: '1', isPrintInfo: false, mode: 'development' }).catch(
        (reason: unknown) => reason,
      )) as Error & { cause?: Error };

      expect((error.cause ?? error).message).toMatch(message);
      expect(close).toHaveBeenCalledOnce();
    },
  );
});
