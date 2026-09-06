import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { RouterState } from 'react-router';
import type { Alias, ModuleNode, RenderBuiltAssetUrl } from 'vite';
import type { IAsyncRoute } from '@helpers/import-route';
import type { TRoutesTree } from '@services/parse-routes';
import ParseRoutes from '@services/parse-routes';
import PathNormalize from '@services/path-normalize';
import type { IAsset, TAssets } from '@services/route-assets';
import RouteAssets, { AssetType } from '@services/route-assets';
import type ServerConfig from '@services/server-config';

interface ISsrManifestParams {
  buildDir?: string;
  viteAliases?: Alias[];
  basename?: string;
  renderBuiltUrl?: RenderBuiltAssetUrl;
}

interface IManifest {
  [path: string]: {
    assets: string[];
    css: string[];
    file: string;
    isEntry?: boolean;
    imports: string[];
  };
}

/**
 * Working with SSR Manifest file
 */
class SsrManifest extends RouteAssets {
  /**
   * Singleton
   */
  protected static instance: SsrManifest | null = null;

  /**
   * Server config
   */
  protected readonly config: ServerConfig;

  /**
   * Path normalize service
   */
  protected readonly pathNormalize: PathNormalize;

  /**
   * Project root path
   */
  protected readonly root: string;

  /**
   * Build dir
   */
  protected readonly buildDir?: string;

  /**
   * Client manifest file name
   */
  protected readonly manifestName = 'manifest.json';

  /**
   * Vite resolve aliases
   */
  protected readonly viteAliases?: Alias[];

  /**
   * Vite base
   */
  protected readonly basename?: string;

  /**
   * Vite renderBuiltUrl config func
   */
  protected readonly renderBuiltUrl?: RenderBuiltAssetUrl;

  /**
   * @constructor
   */
  protected constructor(
    config: ServerConfig,
    { buildDir, viteAliases, basename, renderBuiltUrl }: ISsrManifestParams = {},
  ) {
    super(path.resolve(config.getParams().root, buildDir || ''), config.isModulePreload);

    this.config = config;
    this.root = config.getParams().root;
    this.buildDir = buildDir;
    this.viteAliases = viteAliases ?? config.getVite()?.config?.resolve.alias;
    this.pathNormalize = new PathNormalize(config, viteAliases);
    this.basename = basename;
    this.renderBuiltUrl = renderBuiltUrl;
  }

  /**
   * Get singleton instance
   */
  public static get(config: ServerConfig, params: ISsrManifestParams = {}): SsrManifest {
    if (SsrManifest.instance === null) {
      SsrManifest.instance = new SsrManifest(config, params);
    }

    return SsrManifest.instance;
  }

  /**
   * Use inline styles while the managed Vite server is running.
   */
  protected get isDev(): boolean {
    return Boolean(this.config.getVite());
  }

  /**
   * Get output dir.
   */
  protected getOutDir(): string {
    return path.resolve(this.root, this.buildDir || '');
  }

  /**
   * Keep the managed server's build path resolution.
   */
  protected getAssetsManifestFile(): string {
    return `${this.getOutDir()}/server/assets-manifest.json`;
  }

  /**
   * Load client ssr manifest
   */
  protected loadClientManifest(): IManifest {
    const clientManifestDir = path.resolve(this.root, `${this.buildDir || ''}/client/.vite`);
    const clientSsrManifest = `${clientManifestDir}/${this.manifestName}`;

    if (!fs.existsSync(clientSsrManifest)) {
      return {};
    }

    const result = JSON.parse(
      fs.readFileSync(clientSsrManifest, { encoding: 'utf-8' }),
    ) as IManifest;

    fs.rmSync(clientSsrManifest);

    // try to remove empty .vite dir
    if (fs.readdirSync(clientManifestDir).length === 0) {
      fs.rmSync(clientManifestDir, { recursive: true });
    }

    return result;
  }

  /**
   * Same as 'getAsyncRoutesIds' but for routes tree from 'ParseRoutes'
   */
  protected getRoutesTreeIds(
    routes: TRoutesTree[],
    index?: string,
  ): Record<string, string | undefined> {
    const result: Record<string, string | undefined> = {};

    routes.forEach((route) => {
      const position = [index, String(route.index)].filter(Boolean).join('-');
      const routeId = route.id ?? position;

      if (route.import) {
        result[routeId] = this.pathNormalize.getAppPath(route.import);
      }

      if (route.children.length > 0) {
        Object.assign(result, this.getRoutesTreeIds(route.children, position));
      }
    });

    return result;
  }

  /**
   * Get recursive module assets
   */
  protected getRouteAssets(
    manifest: IManifest,
    module: IManifest[string],
    isNested = false,
  ): Record<string, IAsset> {
    const rootAssets = [...(module?.assets ?? []), ...(module?.css ?? []), module?.file];

    const assets = rootAssets.reduce(
      (res, asset) => {
        if (asset) {
          const type = this.getAssetType(asset);
          const isEntry = module.isEntry && module.file === asset;

          // keep only js,css,image,fonts files
          if (type) {
            const filename = path.posix.normalize(`${this.basename}/${asset}`);
            const modifiedFilename = this.renderBuiltUrl?.(filename, {
              type: 'asset',
              ssr: true,
              hostId: '',
              hostType: filename.split('.').at(-1)?.toLowerCase() as 'js',
            });

            res[asset] = {
              url: typeof modifiedFilename === 'string' ? modifiedFilename : filename,
              weight: isEntry ? 1.9 : this.getAssetWeight(asset),
              type,
              isNested,
              isPreload: !isEntry,
            };
          }
        }

        return res;
      },
      {} as Record<string, IAsset>,
    );

    // nested assets
    if (module?.imports?.length) {
      module.imports.forEach((nestedAsset) => {
        const nestedModule = manifest[nestedAsset];

        if (nestedModule) {
          Object.assign(assets, this.getRouteAssets(manifest, nestedModule, true));
        }
      });
    }

    return assets;
  }

  /**
   * Build routes manifest file
   */
  public buildRoutesManifest(): void {
    const manifest = this.loadClientManifest();
    const routesService = new ParseRoutes(this.config, this.viteAliases);
    const routesPaths = this.getRoutesTreeIds(routesService.parse());

    const postfixes = this.pathNormalize.getImportPostfix();
    const result: Record<string, IAsset[]> = {};

    // find route assets
    Object.entries(routesPaths).forEach(([routeId, routePath]) => {
      const routePostfix = postfixes.find((postfix) => {
        const filePath = `${routePath}${postfix}`;

        return manifest[filePath] !== undefined;
      });
      const routeFile = `${routePath}${routePostfix || ''}`;
      const routeMeta = manifest[routeFile];

      result[routeId] = this.sortAssets(Object.values(this.getRouteAssets(manifest, routeMeta)));
    });

    fs.writeFileSync(this.getAssetsManifestFile(), JSON.stringify(result, null, 2), {
      encoding: 'utf-8',
    });
  }

  /**
   * Get route assets from Vite in development or the built manifest in production.
   */
  protected getAssets(routes?: RouterState['matches']): IAsset[] {
    return this.isDev ? this.getAssetsDev(routes) : super.getAssets(routes);
  }

  /**
   * Get development route assets
   */
  protected getDevModules(routes?: RouterState['matches']): ModuleNode[] {
    const routeIds =
      (routes
        ?.map(({ route }) => this.pathNormalize.getAppPath((route as IAsyncRoute)?.pathId, true))
        .filter(Boolean) as string[]) ?? [];

    const postfixes = this.pathNormalize.getImportPostfix();
    const pluginConfig = this.config.getPluginConfig();
    const rootIds = [
      pluginConfig?.clientFile ?? 'client.ts',
      pluginConfig?.serverFile ?? 'server.ts',
    ].map((file) => path.resolve(this.root, file));
    const modules: ModuleNode[] = [];

    [...rootIds, ...routeIds].forEach((moduleId) => {
      for (const ext of postfixes) {
        const module = this.config.getVite()?.moduleGraph.getModuleById(`${moduleId}${ext}`);

        if (module) {
          modules.push(module);
          break;
        }
      }
    });

    return modules;
  }

  /**
   * Compile SSR graph styles before the browser has populated the client graph.
   */
  public async prepareDevAssets(routes?: RouterState['matches']): Promise<void> {
    const vite = this.config.getVite();

    if (!vite) {
      return;
    }

    const visited = new Set<string>();

    /**
     * Transform each stylesheet once, including dependencies shared by several routes.
     */
    const visit = async (module: ModuleNode): Promise<void> => {
      if (visited.has(module.url)) {
        return;
      }

      visited.add(module.url);

      if (module.file && /\.(?:css|less|s[ac]ss|styl(?:us)?|pcss|postcss)$/.test(module.file)) {
        await vite.transformRequest(module.url);
      }

      await Promise.all([...module.importedModules].map(visit));
    };

    await Promise.all(this.getDevModules(routes).map(visit));
  }

  /**
   * Collect development assets from the current server and client module graphs.
   */
  protected getAssetsDev(routes?: RouterState['matches']): IAsset[] {
    const assets = Object.assign(
      {},
      ...this.getDevModules(routes).map((module) => this.getModuleAssets(module)),
    ) as TAssets;

    return Object.values(assets);
  }

  /**
   * Get module assets
   */
  protected getModuleAssets(module?: ModuleNode, skipModules: Set<string> = new Set()): TAssets {
    const imports = module?.importedModules ?? module?.clientImportedModules;

    if (!imports?.size || skipModules.has(module!.file!)) {
      return {};
    }

    let assets: TAssets = {};

    skipModules.add(module!.file!);

    imports.forEach((subModule) => {
      const { file, transformResult } = subModule;
      const ext = file?.split('.').at(-1);

      if (
        file &&
        ext &&
        ['css', 'scss', 'sass', 'less', 'styl', 'stylus', 'pcss', 'postcss'].includes(ext)
      ) {
        // @TODO investigate better method?
        const code = transformResult?.code.match(/__vite__css\s+=\s+"(?<css>.+)"/)?.groups?.css;

        if (code) {
          try {
            assets[file] = {
              type: AssetType.style,
              url: file,
              weight: this.getAssetWeight(file),
              content: (JSON.parse(`{"style": "${code}"}`) as { style: string }).style,
              isNested: Boolean(skipModules.size),
              isPreload: false,
            };
          } catch {
            console.warn(chalk.yellowBright('Failed to parse style: ', file));
          }
        }
      } else {
        assets = {
          ...assets,
          ...this.getModuleAssets(subModule, skipModules),
        };
      }
    });

    return assets;
  }

  /**
   * Get asset weight
   */
  protected getAssetWeight(asset: string): number {
    const type = this.getAssetType(asset);

    switch (type) {
      case AssetType.style:
        return 1;

      case AssetType.script:
        return 2;

      default:
        return 3;
    }
  }

  /**
   * Get asset type
   */
  protected getAssetType(asset: string): AssetType | null {
    const ext = asset.split('.').at(-1)?.toLowerCase();

    switch (ext) {
      case 'css':
      case 'scss':
        return AssetType.style;

      case 'js':
        return AssetType.script;

      case 'svg':
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'webp':
      case 'gif':
      case 'ico':
        return AssetType.image;

      case 'ttf':
      case 'otf':
      case 'woff':
      case 'woff2':
        return AssetType.font;

      default:
        return null;
    }
  }
}

export default SsrManifest;
