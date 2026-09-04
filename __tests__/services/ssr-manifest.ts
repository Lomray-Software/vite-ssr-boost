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
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(manifest, 'loadClientManifest').mockReturnValue({
      'src/routes': {
        assets: ['img.png'],
        css: ['style.css'],
        file: 'route.js',
        imports: ['dep'],
        isEntry: true,
      },
      dep: {
        assets: [],
        css: ['dep.css'],
        file: 'dep.js',
        imports: [],
      },
    });

    const assets = manifest.getRouteAssets(
      manifest.loadClientManifest(),
      manifest.loadClientManifest()['src/routes'],
    );

    expect(Object.keys(assets)).toEqual(
      expect.arrayContaining(['img.png', 'style.css', 'route.js', 'dep.css', 'dep.js']),
    );

    manifest.buildRoutesManifest();

    expect(writeFileSync).toHaveBeenCalled();
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
