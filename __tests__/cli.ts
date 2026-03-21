// @vitest-environment node
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import buildCli from '@cli/build';
import onKeyPress from '@cli/helpers/keyboard-input';
import viteResetCache from '@cli/helpers/vite-reset-cache';
import runAmplifyBuild from '@cli/run-amplify-build';
import runDev from '@cli/run-dev';
import runDockerBuild from '@cli/run-docker-build';
import runProd from '@cli/run-prod';
import runServerless from '@cli/run-serverless';
import runVercelBuild from '@cli/run-vercel-build';
import cliContext from '@constants/cli-context';

const {
  BuildMock,
  createServerMock,
  resolveConfigMock,
  getPluginConfigMock,
  setCurrentEntrypointNameMock,
  printServerInfoMock,
  processStopMock,
} = vi.hoisted(() => ({
  BuildMock: vi.fn(),
  createServerMock: vi.fn(),
  resolveConfigMock: vi.fn(),
  getPluginConfigMock: vi.fn(),
  setCurrentEntrypointNameMock: vi.fn(),
  printServerInfoMock: vi.fn(),
  processStopMock: vi.fn(),
}));

vi.mock('@services/build', () => ({
  default: BuildMock,
}));
vi.mock('@node/server', () => ({
  default: createServerMock,
}));
vi.mock('vite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vite')>();

  return {
    ...actual,
    resolveConfig: resolveConfigMock,
  };
});
vi.mock('@helpers/plugin-config', () => ({
  default: getPluginConfigMock,
}));
vi.mock('@plugins/handle-custom-entrypoint', () => ({
  setCurrentEntrypointName: setCurrentEntrypointNameMock,
}));
vi.mock('@helpers/print-server-info', () => ({
  default: printServerInfoMock,
}));
vi.mock('@helpers/process-stop', () => ({
  default: processStopMock,
}));

describe('cli integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cliContext.config = undefined;
    cliContext.server = undefined;
  });

  it('should print build duration info', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(1300);
    const build = vi.fn().mockResolvedValue(undefined);
    BuildMock.mockImplementation(function MockBuild() {
      return {
        build,
        getRunningBuildNames: () => ['client', 'server'],
        getIsProd: () => false,
        getNodeEnv: () => 'development',
      };
    } as never);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await buildCli({ mode: 'production' } as never);

    expect(build).toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });

  it('should run dev/prod/serverless wrappers', async () => {
    createServerMock.mockResolvedValue({
      run: vi.fn(() => 'server'),
      app: 'app',
    });

    expect(await runDev({ version: '1', entrypointName: 'worker' })).toEqual({
      server: 'server',
      config: expect.anything(),
    });
    expect(setCurrentEntrypointNameMock).toHaveBeenCalledWith('worker');

    expect(await runProd({ version: '1', focusOnly: 'client' })).toEqual({
      server: 'server',
      config: expect.anything(),
    });

    expect(await runServerless({ version: '1' })).toBe('app');
    expect(printServerInfoMock).toHaveBeenCalled();
  });

  it('should reset vite cache when cache dir exists', async () => {
    resolveConfigMock.mockResolvedValue({ cacheDir: '/tmp/cache' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const rmSync = vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined);

    await viteResetCache();

    expect(rmSync).toHaveBeenCalledWith('/tmp/cache', { recursive: true, force: true });
  });

  it('should create docker build command', async () => {
    resolveConfigMock.mockResolvedValue({
      root: '/workspace',
      build: { outDir: 'dist' },
    });
    getPluginConfigMock.mockReturnValue({ pluginPath: '/plugin' });
    const execSync = vi.spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

    await runDockerBuild({ imageName: 'app:test', focusOnly: 'client' });

    expect(execSync).toHaveBeenCalled();
  });

  it('should create amplify build and vercel build artifacts', async () => {
    resolveConfigMock.mockResolvedValue({
      root: '/workspace',
      build: { outDir: 'dist' },
    });
    getPluginConfigMock.mockReturnValue({ pluginPath: '/plugin' });
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (filepath) =>
        String(filepath).includes('start.js') ||
        String(filepath).includes('serverless.js') ||
        String(filepath).includes('.amplify-hosting') ||
        String(filepath).includes('.vercel/output'),
    );
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const execSync = vi.spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

    await runAmplifyBuild({});
    await runVercelBuild({});

    expect(execSync).toHaveBeenCalled();
  });

  it('should process keyboard shortcuts and ctrl+c', async () => {
    const close = vi.fn((cb?: (e?: unknown) => void) => {
      cb?.();

      return true;
    });
    const info = vi.fn();
    const getVite = () => ({ config: {} });
    cliContext.server = { close } as never;
    cliContext.config = {
      isProd: false,
      getLogger: () => ({ info }),
      getVite,
    } as never;
    getPluginConfigMock.mockReturnValue({
      customShortcuts: [
        {
          key: 'x',
          description: 'custom',
          action: vi.fn(),
        },
      ],
    });

    onKeyPress('h');
    onKeyPress('\r');
    await onKeyPress('x');
    onKeyPress('\x03');

    expect(info).toHaveBeenCalled();
    expect(processStopMock).toHaveBeenCalled();
  });
});
