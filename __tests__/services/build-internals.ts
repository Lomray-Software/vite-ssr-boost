// @vitest-environment node
import childProcess from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Build from '@services/build';
type TBuildPrivate = Record<string, any>;

const {
  resolveConfigMock,
  getPluginConfigMock,
  viteResetCacheMock,
  createDevMarkerMock,
  processStopMock,
  ssrManifestBuildMock,
} = vi.hoisted(() => ({
  resolveConfigMock: vi.fn(),
  getPluginConfigMock: vi.fn(),
  viteResetCacheMock: vi.fn(),
  createDevMarkerMock: vi.fn(),
  processStopMock: vi.fn(),
  ssrManifestBuildMock: vi.fn(),
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
vi.mock('@cli/helpers/vite-reset-cache', () => ({
  default: viteResetCacheMock,
}));
vi.mock('@helpers/dev-marker', () => ({
  createDevMarker: createDevMarkerMock,
}));
vi.mock('@helpers/process-stop', () => ({
  default: processStopMock,
}));
vi.mock('@services/ssr-manifest', () => ({
  default: {
    get: vi.fn(() => ({
      buildRoutesManifest: ssrManifestBuildMock,
    })),
  },
}));

describe('Build internals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  const prepareService = (params: Record<string, any> = {}) => {
    const service = new Build({ mode: 'production', ...params }) as unknown as TBuildPrivate;
    service.viteConfig = {
      root: '/root',
      base: '/',
      build: { outDir: 'dist' },
      resolve: { alias: [] },
      experimental: {},
    } as any;
    service.pluginConfig = {
      clientFile: 'client.ts',
      serverFile: 'server.ts',
      entrypoint: [{ name: 'worker', type: 'spa', buildOptions: '--minify' }],
    } as any;
    service.buildDir = '/root/dist';
    service.isProd = true;
    service.nodeEnv = 'production';
    service.abortController = new AbortController();
    service.runningBuild = [];

    return service;
  };

  it('should make config and expose getters', async () => {
    process.env.NODE_ENV = 'production';
    resolveConfigMock.mockResolvedValue({
      root: '/root',
      base: '/',
      build: { outDir: 'dist' },
      resolve: { alias: [] },
      experimental: {},
    });
    getPluginConfigMock.mockReturnValue({ serverFile: 'server.ts' });

    const service = new Build({ mode: 'production' }) as unknown as TBuildPrivate;
    await service.makeConfig();

    expect(service.getIsProd()).toBe(true);
    expect(service.getNodeEnv()).toBe('production');
  });

  it('should clear build folder, unlock robots, eject and create serverless', () => {
    const service = prepareService();
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const rmSync = vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined);
    const readFileSync = vi.spyOn(fs, 'readFileSync').mockReturnValue('Disallow: /' as never);
    const writeFileSync = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    service.clearBuildFolder();
    service.unlockRobots();
    service.eject();
    service.createServerless();

    expect(rmSync).toHaveBeenCalled();
    expect(readFileSync).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalled();
  });

  it('should promisify process and detect warnings', async () => {
    const service = prepareService();
    let exitHandler!: (code: number) => void;
    let closeHandler!: (code: number) => void;
    let errorHandler!: (message: string) => void;
    const stderrDataHandlers: ((buff: Uint8Array) => void)[] = [];
    const command = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'exit') exitHandler = handler as never;
        if (event === 'close') closeHandler = handler as never;
        if (event === 'error') errorHandler = handler as never;
      }),
      stdout: { pipe: vi.fn(), on: vi.fn() },
      stderr: {
        pipe: vi.fn(),
        on: vi.fn((event: string, handler: (buff: Uint8Array) => void) => {
          if (event === 'data') stderrDataHandlers.push(handler);
        }),
      },
    };

    const result = service.promisifyProcess(command as never, true);
    stderrDataHandlers.forEach((handler) =>
      handler(new TextEncoder().encode('WARNING SSR_BOOST_OUTLET_')),
    );
    stderrDataHandlers.forEach((handler) =>
      handler(new TextEncoder().encode('MISSING cookie=secret-build-data')),
    );
    expect([...service.diagnosticCodes]).toEqual(['SSR_BOOST_OUTLET_MISSING']);
    exitHandler(0);
    closeHandler(0);
    errorHandler('err');

    await expect(result.promise).resolves.toBe(1);
  });

  it('should spawn builds, wait latest and preview watch mode', async () => {
    const service = prepareService({ mode: 'development', onFinish: vi.fn() });
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const writeFile = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const stdout = {
      pipe: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const stderr = {
      pipe: vi.fn(),
      on: vi.fn(),
    };
    vi.spyOn(childProcess, 'spawn').mockReturnValue({
      on: vi.fn((event, handler) => {
        if (event === 'exit') handler(0);
        if (event === 'close') handler(0);
      }),
      stdout,
      stderr,
    } as never);

    await service.spawnBuild('client', '--outDir dist/client', {
      shouldWait: true,
      focusOnly: 'client',
    });
    expect(service.getRunningBuildNames()).toEqual(['client']);
    expect(processStopMock).toHaveBeenCalled();

    service.runPreviewMode();
    stdout.on.mock.calls.forEach(([, listener]) =>
      listener(new TextEncoder().encode('built in 123ms')),
    );
    expect(createDevMarkerMock).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith('/root/dist/server/ssr-boost.json', expect.any(String));
  });

  it('writes resolved serving options without retaining source paths or executable plugin options', () => {
    const service = prepareService();
    service.pluginConfig.indexFile = 'shop.html';
    service.pluginConfig.serverFile = 'entries/shop.tsx';
    service.pluginConfig.customShortcuts = [{ action: () => undefined }];
    service.viteConfig.base = '/shop/';
    service.viteConfig.mode = 'staging';
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const writeFile = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    service.writeProductionConfig();

    expect(JSON.parse(String(writeFile.mock.calls[0][1]))).toEqual({
      version: 1,
      root: '..',
      base: '/shop/',
      mode: 'staging',
      publicDir: 'client',
      indexFile: 'client/shop.html',
      serverFile: 'server/shop.js',
    });
  });

  it.each([
    {
      label: 'empty',
      codes: [],
      expected: '{\n  "codes": []\n}',
    },
    {
      label: 'existing split warning',
      codes: ['SSR_BOOST_OUTLET_MISSING'],
      expected: '{\n  "codes": [\n    "SSR_BOOST_OUTLET_MISSING"\n  ]\n}',
    },
    {
      label: 'all known codes in discovery order with duplicates',
      codes: [
        'SSR_BOOST_LOADER_NOT_SERIALIZABLE',
        'SSR_BOOST_STATE_NOT_SERIALIZABLE',
        'SSR_BOOST_OUTLET_MISSING',
        'SSR_BOOST_HYDRATION_STATE_MISSING',
        'SSR_BOOST_DUPLICATE_OUTPUT',
        'SSR_BOOST_ONRESPONSE_INVALID_RETURN',
        'SSR_BOOST_OUTLET_MISSING',
      ],
      expected: `{
  "codes": [
    "SSR_BOOST_DUPLICATE_OUTPUT",
    "SSR_BOOST_HYDRATION_STATE_MISSING",
    "SSR_BOOST_LOADER_NOT_SERIALIZABLE",
    "SSR_BOOST_ONRESPONSE_INVALID_RETURN",
    "SSR_BOOST_OUTLET_MISSING",
    "SSR_BOOST_STATE_NOT_SERIALIZABLE"
  ]
}`,
    },
  ])(
    'should preserve diagnostic manifest bytes through the full build: $label',
    async ({ codes, expected }) => {
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
      const service = prepareService({
        focusOnly: 'all',
        isUnlockRobots: true,
        onFinish: vi.fn(),
      });
      vi.spyOn(service, 'makeConfig').mockResolvedValue(undefined);
      vi.spyOn(service, 'clearBuildFolder').mockImplementation(() => undefined);
      vi.spyOn(service, 'spawnBuild').mockImplementation(async () => {
        codes.forEach((code) => service.diagnosticCodes.add(code));
      });
      vi.spyOn(service, 'buildManifest').mockImplementation(() => undefined);
      vi.spyOn(service, 'unlockRobots').mockImplementation(() => undefined);

      await service.build();
      expect(write).toHaveBeenCalledWith('/root/dist/ssr-boost-diagnostics.json', expected);

      expect(viteResetCacheMock).toHaveBeenCalled();
      expect(service.spawnBuild).toHaveBeenCalled();
      expect(service.buildManifest).toHaveBeenCalled();
      expect(service.unlockRobots).toHaveBeenCalled();
      expect(createDevMarkerMock).toHaveBeenCalled();
    },
  );

  it('should run manifest builder directly', () => {
    const service = prepareService();

    service.buildManifest();

    expect(ssrManifestBuildMock).toHaveBeenCalled();
  });
});
