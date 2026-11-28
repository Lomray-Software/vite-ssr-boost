import { afterEach, describe, expect, it, vi } from 'vitest';
import { runStart } from '@cli/start';
import cliContext from '@constants/cli-context';

const { runProdMock } = vi.hoisted(() => ({ runProdMock: vi.fn() }));

vi.mock('@cli/run-prod', () => ({ default: runProdMock }));
vi.mock('@cli/helpers/enable-shortcuts', () => ({ default: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: vi.fn(() => JSON.stringify({ version: '0.0.0-test' })),
}));

describe('runStart', () => {
  afterEach(() => {
    runProdMock.mockReset();
    cliContext.server = undefined;
    cliContext.config = undefined;
    cliContext.lifecycle = undefined;
    cliContext.reboot = undefined;
  });

  it('should pass the managed server and the other options to the production run', async () => {
    const result = { server: {}, config: {}, lifecycle: {} };

    runProdMock.mockResolvedValue(result);

    await runStart({
      host: true,
      port: 8080,
      focusOnly: 'app',
      modulePreload: true,
      buildDir: 'out',
      server: 'node',
    });

    expect(runProdMock).toHaveBeenCalledTimes(1);
    expect(runProdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        version: '0.0.0-test',
        isHost: true,
        port: 8080,
        focusOnly: 'app',
        modulePreload: true,
        buildDir: 'out',
        server: 'node',
      }),
    );
    expect(cliContext.server).toBe(result.server);
    expect(cliContext.lifecycle).toBe(result.lifecycle);
  });

  it('should restart with the same managed server', async () => {
    runProdMock.mockResolvedValue({ server: {}, config: {} });

    await runStart({ server: 'express' });
    await cliContext.reboot?.();

    expect(runProdMock).toHaveBeenCalledTimes(2);
    expect(runProdMock.mock.calls.map(([params]) => (params as { server: string }).server)).toEqual(
      ['express', 'express'],
    );
  });
});
