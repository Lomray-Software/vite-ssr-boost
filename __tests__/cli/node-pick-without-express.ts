// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import runDev from '@cli/run-dev';
import PLUGIN_NAME from '@constants/plugin-name';

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
});
