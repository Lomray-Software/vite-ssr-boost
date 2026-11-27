// @vitest-environment node
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
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
import PLUGIN_NAME from '@constants/plugin-name';

const {
  BuildMock,
  createServerMock,
  resolveConfigMock,
  loadConfigFromFileMock,
  getPluginConfigMock,
  setCurrentEntrypointNameMock,
  printServerInfoMock,
  processStopMock,
  createProductionServerMock,
  createDevServerMock,
  loadProductionConfigMock,
  findBuildDirMock,
} = vi.hoisted(() => ({
  findBuildDirMock: vi.fn(),
  createProductionServerMock: vi.fn(),
  createDevServerMock: vi.fn(),
  loadProductionConfigMock: vi.fn(),
  BuildMock: vi.fn(),
  createServerMock: vi.fn(),
  resolveConfigMock: vi.fn(),
  loadConfigFromFileMock: vi.fn(),
  getPluginConfigMock: vi.fn(),
  setCurrentEntrypointNameMock: vi.fn(),
  printServerInfoMock: vi.fn(),
  processStopMock: vi.fn(),
}));

vi.mock('@services/build', () => ({
  default: BuildMock,
}));
vi.mock('@adapters/express/server', () => ({
  default: createServerMock,
}));
vi.mock('vite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vite')>();

  return {
    ...actual,
    resolveConfig: resolveConfigMock,
    loadConfigFromFile: loadConfigFromFileMock,
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
vi.mock('@node/production', () => ({
  createProductionServer: createProductionServerMock,
}));
vi.mock('@node/dev', () => ({
  createDevServer: createDevServerMock,
}));
vi.mock('@services/production-config', () => ({
  default: loadProductionConfigMock,
  findBuildDir: findBuildDirMock,
}));

/**
 * Lifecycle double that records its signal subscription.
 */
const createLifecycleMock = () => {
  const release = vi.fn();

  return {
    release,
    lifecycle: {
      handleSignals: vi.fn(() => release),
      close: vi.fn().mockResolvedValue(undefined),
      isDraining: vi.fn(() => false),
      force: vi.fn(),
    },
  };
};

/**
 * Express server double: the CLI waits for its listening event before taking signals.
 */
const expressServer = Object.assign(new EventEmitter(), { id: 'server' });

/**
 * Let queued promise callbacks run.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('cli integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cliContext.config = undefined;
    cliContext.server = undefined;
    cliContext.lifecycle = undefined;
    cliContext.isExiting = undefined;
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
    loadConfigFromFileMock.mockResolvedValue({ config: { plugins: [] } });
    createServerMock.mockResolvedValue({
      run: vi.fn(() => expressServer),
      app: 'app',
      getLifecycle: vi.fn(() => undefined),
    });

    expect(await runDev({ version: '1', entrypointName: 'worker' })).toEqual({
      server: expressServer,
      config: expect.anything(),
    });
    expect(setCurrentEntrypointNameMock).toHaveBeenCalledWith('worker');

    expect(await runProd({ version: '1', focusOnly: 'client' })).toEqual({
      server: expressServer,
      config: expect.anything(),
    });

    expect(await runServerless({ version: '1' })).toBe('app');
    expect(printServerInfoMock).toHaveBeenCalled();
  });

  it('should start the node production server when selected by flag or by the build', async () => {
    const { lifecycle, release } = createLifecycleMock();
    const listen = vi.fn().mockResolvedValue(null);

    createProductionServerMock.mockResolvedValue({ server: 'node-server', lifecycle, listen });

    expect(await runProd({ version: '1', server: 'node', port: 4100 })).toEqual({
      server: 'node-server',
      config: expect.anything(),
      lifecycle,
    });
    expect(createProductionServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ compression: true, modulePreload: false }),
    );
    expect(listen).toHaveBeenCalledWith(4100, expect.anything());
    expect(printServerInfoMock).toHaveBeenCalledWith(expect.anything(), {
      version: '1',
      server: 'node-server',
    });
    expect(lifecycle.handleSignals).toHaveBeenCalledWith(
      expect.objectContaining({ onExit: processStopMock }),
    );
    expect(createServerMock).not.toHaveBeenCalled();

    loadProductionConfigMock.mockReturnValueOnce({ managedServer: 'node' });
    await runProd({ version: '1', isPrintInfo: false });

    expect(createProductionServerMock).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it('should fall back from a missing build directory on the node server as in 8.6', async () => {
    const { lifecycle } = createLifecycleMock();

    createProductionServerMock.mockResolvedValue({
      server: 'node-server',
      lifecycle,
      listen: vi.fn().mockResolvedValue(null),
    });
    findBuildDirMock.mockReturnValueOnce('./build');
    await runProd({ version: '1', server: 'node', buildDir: 'missing', isPrintInfo: false });

    expect(findBuildDirMock).toHaveBeenCalledWith('missing');
    expect(createProductionServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ buildDir: './build' }),
    );

    await runProd({ version: '1', server: 'node', buildDir: 'missing', isPrintInfo: false });

    expect(createProductionServerMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ buildDir: 'missing' }),
    );
  });

  it('should let the flag override a persisted node selection', async () => {
    createServerMock.mockResolvedValue({
      run: vi.fn(() => expressServer),
      app: 'app',
      getLifecycle: vi.fn(() => undefined),
    });
    loadProductionConfigMock.mockReturnValueOnce({ managedServer: 'node' });

    expect((await runProd({ version: '1', server: 'express' })).server).toBe(expressServer);
    expect(createProductionServerMock).not.toHaveBeenCalled();
  });

  it('should start the node dev server when selected', async () => {
    const { lifecycle } = createLifecycleMock();
    const listen = vi.fn().mockResolvedValue(null);
    const config = { getParams: () => ({ host: '0.0.0.0', port: 4200 }) };
    const vite = { config: { server: {} as { host?: string } } };

    createDevServerMock.mockResolvedValue({
      config,
      vite,
      server: 'dev-server',
      lifecycle,
      listen,
    });

    expect(await runDev({ version: '1', server: 'node', isHost: true, mode: 'dev' })).toEqual({
      server: 'dev-server',
      config,
      lifecycle,
    });
    expect(createDevServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'dev', isHost: true }),
    );
    expect(vite.config.server.host).toBe('0.0.0.0');
    expect(listen).toHaveBeenCalledWith(4200, '0.0.0.0');
    expect(lifecycle.handleSignals).toHaveBeenCalledWith(
      expect.objectContaining({ onExit: processStopMock }),
    );
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it('should read the dev server selection from the plugin options', async () => {
    const { lifecycle } = createLifecycleMock();

    loadConfigFromFileMock.mockResolvedValue({
      config: {
        plugins: [
          false,
          [
            Promise.resolve([
              { name: 'other' },
              { name: PLUGIN_NAME, pluginOptions: { managedServer: 'node' } },
            ]),
          ],
        ],
      },
    });
    createDevServerMock.mockResolvedValue({
      config: { getParams: () => ({ host: 'h', port: 1 }) },
      vite: { config: { server: {} } },
      server: 'dev-server',
      lifecycle,
      listen: vi.fn().mockResolvedValue(null),
    });

    expect((await runDev({ version: '1', isPrintInfo: false })).server).toBe('dev-server');
    expect(printServerInfoMock).not.toHaveBeenCalled();
  });

  it('should force a drain already under way on ctrl+c and exit once', async () => {
    const { lifecycle } = createLifecycleMock();

    lifecycle.isDraining.mockReturnValue(true);
    cliContext.lifecycle = lifecycle as never;
    onKeyPress('\x03');
    onKeyPress('\x03');
    await flush();

    expect(lifecycle.force).toHaveBeenCalledTimes(2);
    expect(lifecycle.close).toHaveBeenCalledTimes(1);
    expect(processStopMock).toHaveBeenCalledTimes(1);
    expect(processStopMock).toHaveBeenCalledWith(0);
    expect(cliContext.isExiting).toBe(true);
  });

  it('should leave signals to an Express app that subscribed to them', async () => {
    const { lifecycle } = createLifecycleMock();
    const server = new EventEmitter();
    const appListener = () => undefined;

    loadProductionConfigMock.mockReturnValue({});
    createServerMock.mockResolvedValue({
      run: vi.fn(() => server),
      app: 'app',
      getLifecycle: vi.fn(() => lifecycle),
    });

    await runProd({ version: '1', isPrintInfo: false });
    process.on('SIGTERM', appListener);
    server.emit('listening');
    await flush();

    expect(lifecycle.handleSignals).not.toHaveBeenCalled();

    process.off('SIGTERM', appListener);
    await runProd({ version: '1', isPrintInfo: false });
    server.emit('listening');
    await flush();

    expect(lifecycle.handleSignals).toHaveBeenCalledTimes(1);
    expect(lifecycle.handleSignals).toHaveBeenCalledWith(
      expect.objectContaining({ onExit: processStopMock }),
    );
  });

  it('should keep Express when the plugin leaves managedServer unset', async () => {
    loadConfigFromFileMock.mockResolvedValue({
      config: { plugins: [{ name: PLUGIN_NAME, pluginOptions: {} }] },
    });
    createServerMock.mockResolvedValue({
      run: vi.fn(() => expressServer),
      app: 'app',
      getLifecycle: vi.fn(() => undefined),
    });

    expect((await runDev({ version: '1', isPrintInfo: false })).server).toBe(expressServer);
    expect(createDevServerMock).not.toHaveBeenCalled();
  });

  it('should pick the server without resolving the Vite config', async () => {
    resolveConfigMock.mockClear();
    loadConfigFromFileMock.mockResolvedValue(null);
    createServerMock.mockResolvedValue({
      run: vi.fn(() => expressServer),
      app: 'app',
      getLifecycle: vi.fn(() => undefined),
    });

    expect((await runDev({ version: '1', isPrintInfo: false })).server).toBe(expressServer);
    expect(loadConfigFromFileMock).toHaveBeenLastCalledWith({
      command: 'serve',
      mode: 'development',
    });
    expect(resolveConfigMock).not.toHaveBeenCalled();
  });

  it('should surface a Vite config that fails to load instead of falling back to Express', async () => {
    loadConfigFromFileMock.mockRejectedValue(new Error('broken config'));

    await expect(runDev({ version: '1' })).rejects.toThrow('broken config');
    expect(createServerMock).not.toHaveBeenCalled();
    expect(createDevServerMock).not.toHaveBeenCalled();
  });

  it('should close the node dev server when it cannot bind', async () => {
    const { lifecycle } = createLifecycleMock();
    const close = vi.fn().mockResolvedValue(undefined);

    createDevServerMock.mockResolvedValue({
      config: { getParams: () => ({ host: 'h', port: 1 }) },
      vite: { config: { server: {} } },
      server: 'dev-server',
      lifecycle,
      close,
      listen: vi.fn().mockRejectedValue(new Error('EADDRINUSE')),
    });

    await expect(runDev({ version: '1', server: 'node' })).rejects.toThrow('EADDRINUSE');
    expect(close).toHaveBeenCalledTimes(1);
    expect(lifecycle.handleSignals).not.toHaveBeenCalled();
  });

  it('should exit through the lifecycle drain on ctrl+c', async () => {
    const { lifecycle } = createLifecycleMock();

    cliContext.lifecycle = lifecycle as never;
    onKeyPress('\x03');
    await flush();

    expect(lifecycle.close).toHaveBeenCalledTimes(1);
    expect(processStopMock).toHaveBeenCalledWith(0);

    const failing = createLifecycleMock().lifecycle;

    failing.close.mockRejectedValueOnce(new Error('drain failed'));
    cliContext.lifecycle = failing as never;
    onKeyPress('\x04');
    await flush();

    expect(processStopMock).toHaveBeenLastCalledWith(1);
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
