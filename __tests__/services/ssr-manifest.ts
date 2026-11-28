import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SsrManifest from '@services/ssr-manifest';
type TSsrManifestPrivate = Record<string, any>;

const parseMock = vi.fn();

vi.mock('@services/parse-routes', () => ({
  default: vi.fn().mockImplementation(function ParseRoutesMock() {
    return {
      parse: parseMock,
    };
  } as never),
}));

describe('SsrManifest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    parseMock.mockReset();
    (SsrManifest as unknown as { instance: unknown }).instance = null;
  });

  const createConfig = (withVite = false) => {
    const vite = withVite
      ? {
          config: { resolve: { alias: [] } },
          moduleGraph: {
            getModuleById: vi.fn(),
          },
        }
      : undefined;

    return {
      isModulePreload: true,
      getParams: () => ({ root: '/root' }),
      getPluginConfig: () => ({ clientFile: 'client.ts' }),
      getVite: () => vite,
    } as never;
  };

  it('should return singleton instance', () => {
    const config = createConfig();

    expect(SsrManifest.get(config)).toBe(SsrManifest.get(config));
  });

  it('should replace the instance when a restarted server brings a new config', () => {
    const first = SsrManifest.get(createConfig());
    const config = createConfig();
    const second = SsrManifest.get(config);

    expect(second).not.toBe(first);
    expect(SsrManifest.get(config)).toBe(second);
  });

  it('should replace the instance when a restart puts a new Vite on the same config', () => {
    let vite: unknown = { config: { resolve: { alias: [] } } };
    const config = {
      isModulePreload: true,
      getParams: () => ({ root: '/root' }),
      getPluginConfig: () => ({ clientFile: 'client.ts' }),
      getVite: () => vite,
    } as never;
    const first = SsrManifest.get(config);

    expect(SsrManifest.get(config)).toBe(first);

    vite = { config: { resolve: { alias: [] } } };
    const second = SsrManifest.get(config);

    expect(second).not.toBe(first);
    expect(SsrManifest.get(config)).toBe(second);
  });

  it('should key the instance on a given Vite instead of the one the config holds', () => {
    const config = createConfig();
    const own = { config: { resolve: { alias: [] } } };
    const manifest = SsrManifest.get(config, {}, own as never);

    expect(SsrManifest.get(config, {}, own as never)).toBe(manifest);
    expect(SsrManifest.get(config)).not.toBe(manifest);
    expect((manifest as unknown as { vite: unknown }).vite).toBe(own);
  });

  it('should load and cleanup client manifest', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        'src/routes.ts': {
          assets: ['img.png'],
          css: ['style.css'],
          file: 'route.js',
          imports: [],
          isEntry: true,
        },
      }) as never,
    );
    vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([] as never);

    const manifest = SsrManifest.get(createConfig(), {
      buildDir: 'dist',
    }) as unknown as TSsrManifestPrivate;
    const result = manifest.loadClientManifest();

    expect(result['src/routes.ts'].file).toBe('route.js');
  });

  it('should load and memoize assets manifest', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ '0': [{ url: '/a.css' }] }) as never,
    );

    const manifest = SsrManifest.get(createConfig(), {
      buildDir: 'dist',
    }) as unknown as TSsrManifestPrivate;

    expect(manifest.loadAssetsManifest()).toEqual({ '0': [{ url: '/a.css' }] });
    expect(manifest.loadAssetsManifest()).toEqual({ '0': [{ url: '/a.css' }] });
  });

  it('should build route tree ids and sort assets', () => {
    const manifest = SsrManifest.get(createConfig(), {
      buildDir: 'dist',
    }) as unknown as TSsrManifestPrivate;
    manifest.pathNormalize.getAppPath = vi.fn((val: string) => val.replace('@/', ''));

    expect(
      manifest.getRoutesTreeIds([
        {
          import: '@/pages/home',
          children: [{ import: '@/pages/user', children: [], index: 0 }],
          index: 0,
        },
      ]),
    ).toEqual({
      '0': 'pages/home',
      '0-0': 'pages/user',
    });

    expect(
      manifest.sortAssets([
        { weight: 3, isNested: true } as any,
        { weight: 1, isNested: false } as any,
        { weight: 3, isNested: false } as any,
      ]),
    ).toEqual([
      { weight: 1, isNested: false },
      { weight: 3, isNested: false },
      { weight: 3, isNested: true },
    ]);
  });

  it('should collect route assets recursively and build routes manifest', () => {
    const writeFileSync = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const manifest = SsrManifest.get(createConfig(), {
      buildDir: 'dist',
      basename: '/base',
      renderBuiltUrl: (filename) => filename,
    }) as unknown as TSsrManifestPrivate;
    manifest.pathNormalize.getImportPostfix = vi.fn(() => ['', '.ts']);
    manifest.pathNormalize.getAppPath = vi.fn((val: string) => val);
    parseMock.mockReturnValue([{ import: 'src/routes', children: [], index: 0 }]);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(manifest, 'loadClientManifest').mockReturnValue({
      'src/routes': {
        assets: ['img.png'],
        css: ['style.css'],
        file: 'route.js',
        imports: ['dep'],
        isEntry: true,
      },
      'src/styles.css': {
        assets: [],
        css: [],
        file: 'assets/styles-Mn0pQr1s.css',
        imports: [],
        isEntry: true,
      },
      dep: {
        assets: ['assets/logo-Ab12Cd34.svg'],
        css: ['assets/dep-Xy_9-8Zq.css'],
        file: 'assets/dep-Q1w2E3r4.js',
        imports: [],
      },
    });

    const assets = manifest.getRouteAssets(
      manifest.loadClientManifest(),
      manifest.loadClientManifest()['src/routes'],
    );

    expect(Object.keys(assets)).toEqual(
      expect.arrayContaining([
        'img.png',
        'style.css',
        'route.js',
        'assets/dep-Xy_9-8Zq.css',
        'assets/dep-Q1w2E3r4.js',
      ]),
    );

    manifest.buildRoutesManifest();

    expect(writeFileSync).toHaveBeenCalledWith(
      '/root/dist/server/assets-manifest.json',
      expect.any(String),
      { encoding: 'utf-8' },
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      '/root/dist/client/assets-manifest.json',
      writeFileSync.mock.calls[0][1],
      { encoding: 'utf-8' },
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      '/root/dist/server/fingerprinted-files.json',
      `${JSON.stringify(
        [
          'assets/dep-Q1w2E3r4.js',
          'assets/dep-Xy_9-8Zq.css',
          'assets/logo-Ab12Cd34.svg',
          'assets/styles-Mn0pQr1s.css',
        ],
        null,
        2,
      )}\n`,
      { encoding: 'utf-8' },
    );
  });

  it('matches a js asset record against assetFileNames, not chunkFileNames', () => {
    const writeFileSync = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const manifest = SsrManifest.get(createConfig(), {
      buildDir: 'dist',
      buildOutput: { rollupOptions: { output: { assetFileNames: 'assets/[name][extname]' } } },
    }) as unknown as TSsrManifestPrivate;
    manifest.pathNormalize.getImportPostfix = vi.fn(() => ['', '.ts']);
    manifest.pathNormalize.getAppPath = vi.fn((val: string) => val);
    parseMock.mockReturnValue([]);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(manifest, 'loadClientManifest').mockReturnValue({
      // Vite writes `src` without `name` for an `?url` import of a script.
      'src/sw-register.js': { file: 'assets/sw-register.js', src: 'src/sw-register.js' },
      // An entry asset carries `names` beside `name`.
      'src/theme.js': {
        file: 'assets/register.js',
        src: 'src/theme.js',
        isEntry: true,
        name: 'register',
        names: ['register.js'],
      },
      'src/lazy.js': { file: 'assets/lazy-DauyBWxg.js', name: 'lazy', src: 'src/lazy.js' },
    });

    manifest.buildRoutesManifest();

    expect(writeFileSync).toHaveBeenCalledWith(
      '/root/dist/server/fingerprinted-files.json',
      `${JSON.stringify(['assets/lazy-DauyBWxg.js'], null, 2)}\n`,
      { encoding: 'utf-8' },
    );
  });

  it('keeps a non-js record with a chunk name out of the immutable files', () => {
    const writeFileSync = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const manifest = SsrManifest.get(createConfig(), {
      buildDir: 'dist',
      buildOutput: {
        rollupOptions: {
          output: {
            entryFileNames: 'assets/[name]-[hash].bundle',
            assetFileNames: 'assets/[name]-[hash][extname]',
          },
        },
      },
    }) as unknown as TSsrManifestPrivate;
    manifest.pathNormalize.getImportPostfix = vi.fn(() => ['', '.ts']);
    manifest.pathNormalize.getAppPath = vi.fn((val: string) => val);
    parseMock.mockReturnValue([]);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(manifest, 'loadClientManifest').mockReturnValue({
      // A chunk from a pattern without `.js` cannot be told apart from an asset.
      'src/app.ts': {
        file: 'assets/app-DauyBWxg.bundle',
        src: 'src/app.ts',
        isEntry: true,
        name: 'app',
      },
      'src/logo.svg': {
        file: 'assets/logo-B2xQ9kLm.svg',
        src: 'src/logo.svg',
        name: 'logo',
        names: ['logo.svg'],
      },
    });

    manifest.buildRoutesManifest();

    expect(writeFileSync).toHaveBeenCalledWith(
      '/root/dist/server/fingerprinted-files.json',
      `${JSON.stringify(['assets/logo-B2xQ9kLm.svg'], null, 2)}\n`,
      { encoding: 'utf-8' },
    );
  });

  it('keeps an entry from a pattern without a hash out of the immutable files', () => {
    const writeFileSync = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const manifest = SsrManifest.get(createConfig(), {
      buildDir: 'dist',
      buildOutput: {
        rollupOptions: {
          output: {
            entryFileNames: 'assets/[name]-facebook.js',
            assetFileNames: 'assets/[name]-[hash][extname]',
          },
        },
      },
    }) as unknown as TSsrManifestPrivate;
    manifest.pathNormalize.getImportPostfix = vi.fn(() => ['', '.ts']);
    manifest.pathNormalize.getAppPath = vi.fn((val: string) => val);
    parseMock.mockReturnValue([]);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(manifest, 'loadClientManifest').mockReturnValue({
      // An eight-letter suffix from a fixed pattern is no content hash.
      'src/app.ts': {
        file: 'assets/app-facebook.js',
        src: 'src/app.ts',
        isEntry: true,
        name: 'app',
      },
      'src/logo.svg': {
        file: 'assets/logo-B2xQ9kLm.svg',
        src: 'src/logo.svg',
        name: 'logo',
        names: ['logo.svg'],
      },
    });

    manifest.buildRoutesManifest();

    expect(writeFileSync).toHaveBeenCalledWith(
      '/root/dist/server/fingerprinted-files.json',
      `${JSON.stringify(['assets/logo-B2xQ9kLm.svg'], null, 2)}\n`,
      { encoding: 'utf-8' },
    );
  });

  it('fails the build when a lazy route is neither in the client manifest nor on disk', () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const manifest = SsrManifest.get(createConfig(), {
      buildDir: 'dist',
    }) as unknown as TSsrManifestPrivate;
    manifest.pathNormalize.getImportPostfix = vi.fn(() => ['', '.ts']);
    manifest.pathNormalize.getAppPath = vi.fn((val: string) => val);
    parseMock.mockReturnValue([{ import: 'src/pages/missing', children: [], index: 0 }]);
    vi.spyOn(manifest, 'loadClientManifest').mockReturnValue({
      'src/routes': { file: 'route.js' },
    });

    expect(() => manifest.buildRoutesManifest()).toThrow(
      'Lazy routes not found in the client build or on disk: 0 (src/pages/missing)',
    );
  });

  it('keeps server-only builds working without a client output directory', () => {
    const writeFileSync = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    parseMock.mockReturnValue([]);
    const manifest = SsrManifest.get(createConfig(), { buildDir: 'dist' });

    manifest.buildRoutesManifest();

    expect(writeFileSync).toHaveBeenCalledExactlyOnceWith(
      '/root/dist/server/assets-manifest.json',
      '{}',
      { encoding: 'utf-8' },
    );
  });

  it('should collect assets in prod and dev modes', () => {
    const prodManifest = SsrManifest.get(createConfig(), {
      buildDir: 'dist',
    }) as unknown as TSsrManifestPrivate;
    vi.spyOn(prodManifest, 'loadAssetsManifest').mockReturnValue({
      home: [{ type: 'script', url: '/home.js', weight: 2, isNested: false, isPreload: false }],
    });

    expect(prodManifest.getAssets([{ route: { id: 'home' } } as any])).toEqual([
      { type: 'script', url: '/home.js', weight: 2, isNested: false, isPreload: false },
    ]);

    (SsrManifest as unknown as { instance: unknown }).instance = null;

    const devConfig = createConfig(true);
    const devManifest = SsrManifest.get(devConfig, {
      buildDir: 'dist',
    }) as unknown as TSsrManifestPrivate;
    devManifest.pathNormalize.getAppPath = vi.fn((val: string, withRoot?: boolean) =>
      withRoot ? `/root/${val}` : val,
    );
    vi.spyOn(devManifest, 'getModuleAssets').mockReturnValue({
      '/root/page.css': {
        type: 'style',
        url: '/root/page.css',
        weight: 1,
        isNested: false,
        isPreload: false,
        content: '.test{color:red}',
      },
    });
    (devConfig as any)
      .getVite()
      .moduleGraph.getModuleById.mockImplementation((id: string) =>
        id.includes('client.ts') || id.includes('page.tsx') ? { id } : undefined,
      );

    expect(devManifest.getAssetsDev([{ route: { pathId: 'page.tsx' } } as any])).toEqual([
      expect.objectContaining({
        type: 'style',
        url: '/root/page.css',
      }),
    ]);
  });

  it('should expose asset helpers and inject assets into html', () => {
    const manifest = SsrManifest.get(createConfig(true), {
      buildDir: 'dist',
    }) as unknown as TSsrManifestPrivate;
    const html = { header: '<head></head>', footer: '</body>' };
    vi.spyOn(manifest, 'getAssets').mockReturnValue([
      { type: 'style', url: '/a.css', weight: 1, isNested: false, isPreload: false } as any,
      { type: 'script', url: '/app.js', weight: 2, isNested: false, isPreload: false } as any,
      { type: 'script', url: '/preload.js', weight: 2, isNested: false, isPreload: true } as any,
      { type: 'image', url: '/img.png', weight: 3, isNested: false, isPreload: false } as any,
    ]);

    expect(manifest.getAssetWeight('a.css')).toBe(1);
    expect(manifest.getAssetWeight('a.js')).toBe(2);
    expect(manifest.getAssetWeight('a.png')).toBe(3);
    expect(manifest.getAssetType('a.woff2')).toBe('font');
    expect(manifest.getAssetType('a.unknown')).toBeNull();

    const earlyHints = manifest.injectAssets({
      routerContext: { matches: [] } as any,
      html,
    });

    expect(earlyHints.get('link')).toContain('</a.css>');
    expect(earlyHints.get('link')).toContain('</app.js>');
    expect(earlyHints.get('link')).not.toContain('</img.png>');
    expect(html.header).toContain('<style data-vite-dev-id="/a.css"></style>');
    expect(html.header).toContain(
      '<script async type="module" crossorigin src="/app.js"></script>',
    );
    expect(html.header).toContain(
      '<link rel="modulepreload" as="script" crossorigin href="/preload.js">',
    );
  });

  it('prepares cold SSR styles without requiring a browser to populate the client graph', async () => {
    const style: Record<string, any> = {
      file: '/root/page.scss',
      url: '/page.scss',
      importedModules: new Set(),
      transformResult: null,
    };
    const root = {
      file: '/root/server.ts',
      url: '/server.ts',
      importedModules: new Set([style]),
    };
    style.importedModules.add(root);
    const transformRequest = vi.fn(async () => {
      style.transformResult = { code: 'const __vite__css = ".page{color:red}"' };
    });
    const config = {
      getParams: () => ({ root: '/root' }),
      getPluginConfig: () => ({}),
      getVite: () => ({
        config: { resolve: { alias: [] } },
        moduleGraph: { getModuleById: (id: string) => (id === root.file ? root : undefined) },
        transformRequest,
      }),
    };
    const manifest = SsrManifest.get(config as never);
    const html = { header: '<head></head>' };

    await manifest.prepareDevAssets();
    manifest.injectAssets({ html });

    expect(transformRequest).toHaveBeenCalledOnce();
    expect(html.header).toContain(
      '<style data-vite-dev-id="/root/page.scss">.page{color:red}</style>',
    );
  });
});
