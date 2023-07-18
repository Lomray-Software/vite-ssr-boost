import fs from 'node:fs';
import type { Socket } from 'node:net';
import path from 'node:path';
import type { AgnosticDataRouteMatch } from '@remix-run/router/dist/utils';
import type { RouteObject } from 'react-router-dom';
import type { Alias } from 'vite';
import type { IRequestContext } from '@node/render';
import PrepareServer from '@services/prepare-server';
import ServerConfig from '@services/server-config';

interface ISsrManifestParams {
  alias?: Alias[];
  buildDir?: string;
}

interface IManifest {
  [path: string]: {
    assets: string[];
    css: string[];
    file: string;
    imports: string[];
  };
}

const CRLF = '\r\n';

/**
 * Working with SSR Manifest file
 */
class SsrManifest {
  /**
   * Singleton
   */
  protected static instance: SsrManifest | null = null;

  /**
   * Project root path
   */
  protected root: string;

  /**
   * Build dir
   */
  protected buildDir?: string;

  /**
   * Client manifest file name
   */
  protected manifestName = 'manifest.json';

  /**
   * Assets manifest file name
   */
  protected assetsManifest = 'assets-manifest.json';

  /**
   * Vite resolve aliases
   */
  protected alias?: Alias[];

  /**
   * Loaded assets manifest file
   */
  protected routesAssets: Record<string, string[]> | null = null;

  /**
   * @constructor
   */
  protected constructor(root: string, { buildDir, alias }: ISsrManifestParams = {}) {
    this.root = root;
    this.buildDir = buildDir;
    this.alias = alias;
  }

  /**
   * Get singleton instance
   */
  public static get(root: string, params: ISsrManifestParams = {}): SsrManifest {
    if (SsrManifest.instance === null) {
      SsrManifest.instance = new SsrManifest(root, params);
    }

    return SsrManifest.instance;
  }

  /**
   * Get assets manifest file name
   */
  protected getAssetsManifestFile(): string {
    const outDir = path.resolve(this.root, this.buildDir || '');

    return `${outDir}/server/${this.assetsManifest}`;
  }

  /**
   * Load client ssr manifest
   */
  protected loadClientManifest(): IManifest {
    const clientSsrManifest = path.resolve(
      this.root,
      `${this.buildDir || ''}/client/${this.manifestName}`,
    );

    if (!fs.existsSync(clientSsrManifest)) {
      return {};
    }

    const result = JSON.parse(
      fs.readFileSync(clientSsrManifest, { encoding: 'utf-8' }),
    ) as IManifest;

    fs.rmSync(clientSsrManifest);

    return result;
  }

  /**
   * Load assets manifest
   */
  protected loadAssetsManifest(): Record<string, string[]> {
    if (this.routesAssets !== null) {
      return this.routesAssets;
    }

    const manifestFile = this.getAssetsManifestFile();

    if (!fs.existsSync(manifestFile)) {
      return {};
    }

    this.routesAssets = JSON.parse(fs.readFileSync(manifestFile, { encoding: 'utf-8' })) as Record<
      string,
      string[]
    >;

    return this.routesAssets;
  }

  /**
   * Recursive walk routes and return id's with route import path
   */
  protected async getRoutesIds(
    routes: RouteObject[],
    index?: string,
  ): Promise<Record<string, string>> {
    const result = {};

    for (const routeIndex in routes) {
      const route = routes[routeIndex];
      const routeId = [index, routeIndex].filter(Boolean).join('-');

      if (route.lazy) {
        const resolvedRoute = await route.lazy();

        result[routeId] = this.normalizeRoutePath(resolvedRoute?.['pathId'] as string);
      } else if (route.children) {
        Object.assign(result, await this.getRoutesIds(route.children, routeId));
      }
    }

    return result;
  }

  /**
   * Build routes manifest file
   */
  public async buildRoutesManifest(shouldPreloadAssets: boolean): Promise<void> {
    const serverConfig = ServerConfig.init({ isProd: true });
    const prepareServer = PrepareServer.init(serverConfig);
    const manifest = this.loadClientManifest();
    const { routes } = await prepareServer.loadEntrypoint(false);
    const routesPaths = await this.getRoutesIds(routes as RouteObject[]);
    const postfixes = this.getRouteImportPostfix();

    const result = {};

    // find route assets
    Object.entries(routesPaths).forEach(([routeId, routePath]) => {
      const routePostfix = postfixes.find((postfix) => {
        const filePath = `${routePath}${postfix}`;

        return manifest[filePath] !== undefined;
      });
      const routeFile = `${routePath}${routePostfix || ''}`;
      const routeMeta = manifest[routeFile];
      const routeAssets = [
        ...(routeMeta?.assets ?? []),
        ...(routeMeta?.css ?? []),
        routeMeta.file,
        ...(shouldPreloadAssets ? routeMeta?.imports ?? [] : []).map(
          (nestedAsset) => manifest[nestedAsset]?.file,
        ),
      ]
        .filter(
          (asset) =>
            // keep only js,css,image,fonts files
            asset && this.getAssetType(asset),
        )
        .map((asset) => `/${asset}`);

      if (routeAssets) {
        result[routeId] = routeAssets;
      }
    });

    fs.writeFileSync(this.getAssetsManifestFile(), JSON.stringify(result, null, 2), {
      encoding: 'utf-8',
    });
  }

  /**
   * Load aliases manifest
   */
  protected getAliases(): Record<string, string> {
    const aliases = {};

    this.alias?.forEach(({ find, replacement }) => {
      if (typeof find !== 'string') {
        return;
      }

      aliases[find] = replacement;
    });

    return aliases;
  }

  /**
   * Return route postfix
   */
  protected getRouteImportPostfix(): string[] {
    return ['', '/index']
      .map((prefix) => ['.js', '.ts', '.tsx'].map((ext) => `${prefix}${ext}`))
      .flat();
  }

  /**
   * Normalized route path
   */
  protected normalizeRoutePath(routePath?: string): string | undefined {
    if (!routePath) {
      return;
    }

    let fullPath = '';

    // relative import
    if (routePath.startsWith('./') || routePath.startsWith('../')) {
      fullPath = path.resolve(this.root, routePath);
    } else {
      // alias import
      const aliases = this.getAliases();
      // get alias
      const [routeAlias] = routePath.split('/');

      if (aliases[routeAlias]) {
        fullPath = routePath.replace(routeAlias, aliases[routeAlias]);
      }
    }

    return fullPath.replace(this.root, '').replace(/^\/|\/$/g, '');
  }

  /**
   * Get provided route assets
   */
  public getAssets(routes?: AgnosticDataRouteMatch[]): string[] {
    const routeIds = routes?.map(({ route }) => route.id).filter(Boolean) ?? [];

    if (!routeIds.length) {
      return [];
    }

    const routesAssets = this.loadAssetsManifest();

    return routeIds
      .map((routeId) => routesAssets[routeId])
      .filter(Boolean)
      .flat();
  }

  /**
   * Get asset weight
   */
  protected getAssetWeight(asset: string): number {
    const type = this.getAssetType(asset);

    switch (type) {
      case 'style':
        return 1;

      case 'script':
        return 2;

      default:
        return 3;
    }
  }

  /**
   * Get asset type
   */
  protected getAssetType(asset: string): string | null {
    const ext = asset.split('.').at(-1)?.toLowerCase();

    switch (ext) {
      case 'css':
        return 'style';

      case 'js':
        return 'script';

      case 'svg':
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'webp':
      case 'gif':
      case 'ico':
        return 'image';

      case 'ttf':
      case 'otf':
      case 'woff':
      case 'woff2':
        return 'font';

      default:
        return null;
    }
  }

  /**
   * Write 103 Early Hits header
   */
  public writeEarlyHits(assets: string[], socket: Socket): void {
    socket.write(`HTTP/1.1 103 Early Hints${CRLF}`);
    assets.forEach((asset) => {
      const type = this.getAssetType(asset);

      if (!type || !['style', 'script'].includes(type)) {
        return;
      }

      socket.write(`Link: <${asset}>; rel=preload; as=${type}${CRLF}`);
    });
    socket.write(CRLF);
  }

  /**
   * Inject route assets to head html
   */
  public injectAssets({ routerContext, html, res, hasEarlyHints = true }: IRequestContext): void {
    const assets = this.getAssets(routerContext?.matches).sort((a, b) => {
      const aWeight = this.getAssetWeight(a);
      const bWeight = this.getAssetWeight(b);

      return aWeight === bWeight ? 0 : aWeight - bWeight;
    });
    const htmlAssets = assets
      .map((asset) => {
        if (asset.endsWith('.css')) {
          return `<link rel="stylesheet" href="${asset}">`;
        } else if (asset.endsWith('.js')) {
          return `<script async type="module" src="${asset}"></script>`;
        }

        return null;
      })
      .filter(Boolean);

    html.header = html.header.replace('</head>', `${htmlAssets.join('\n')}</head>`);

    if (hasEarlyHints && htmlAssets.length && res.socket) {
      this.writeEarlyHits(assets, res.socket);
    }
  }
}

export default SsrManifest;
