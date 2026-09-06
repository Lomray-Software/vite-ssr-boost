import fs from 'node:fs';
import path from 'node:path';
import type { RouterState, StaticHandlerContext } from 'react-router';

enum AssetType {
  style = 'style',
  script = 'script',
  image = 'image',
  font = 'font',
}

interface IAsset {
  type: AssetType;
  url: string;
  weight: number;
  isNested: boolean;
  isPreload: boolean;
  content?: string;
}

type TAssets = { [id: string]: IAsset };

interface IInjectAssetsContext {
  html: {
    header: string;
  };
  routerContext?: StaticHandlerContext;
  matches?: RouterState['matches'];
  isSpa?: boolean;
}

/**
 * Load and inject route assets with an independent cache for one build.
 */
class RouteAssets {
  protected readonly outputDir: string;

  protected readonly modulePreload: boolean;

  protected routesAssets: Record<string, IAsset[]> | null = null;

  constructor(buildDir: string, modulePreload = false) {
    this.outputDir = path.resolve(buildDir);
    this.modulePreload = modulePreload;
  }

  /**
   * Development manifests override this to inject inline styles.
   */
  protected get isDev(): boolean {
    return false;
  }

  /**
   * Get assets manifest file name.
   */
  protected getAssetsManifestFile(): string {
    return path.join(this.outputDir, 'server', 'assets-manifest.json');
  }

  /**
   * Load assets manifest
   */
  protected loadAssetsManifest(): Record<string, IAsset[]> {
    if (this.routesAssets !== null) {
      return this.routesAssets;
    }

    const manifestFile = this.getAssetsManifestFile();

    if (!fs.existsSync(manifestFile)) {
      return {};
    }

    this.routesAssets = JSON.parse(fs.readFileSync(manifestFile, { encoding: 'utf-8' })) as Record<
      string,
      IAsset[]
    >;

    return this.routesAssets;
  }

  /**
   * Sort assets
   */
  protected sortAssets(assets: IAsset[]): IAsset[] {
    return assets.sort((a, b) =>
      a.weight === b.weight ? Number(a.isNested) - Number(b.isNested) : a.weight - b.weight,
    );
  }

  /**
   * Get route assets
   */
  // The development manifest uses the SPA flag to preload unqueried lazy routes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected getAssets(routes?: RouterState['matches'], _isSpa?: boolean): IAsset[] {
    const routeIds = routes?.map(({ route }) => route.id).filter(Boolean) ?? [];

    if (!routeIds.length) {
      return [];
    }

    const routesAssets = this.loadAssetsManifest();

    return this.sortAssets(
      routeIds
        .map((routeId) => routesAssets[routeId])
        .flat()
        .filter(Boolean),
    );
  }

  /**
   * Build preload hints without depending on a particular HTTP transport.
   */
  public getEarlyHints(assets: IAsset[]): Headers {
    const headers = new Headers();

    assets.forEach(({ type, url }) => {
      if (!type || !['style', 'script'].includes(type)) {
        return;
      }

      headers.append('Link', `<${url}>; rel=preload; as=${type}`);
    });

    return headers;
  }

  /**
   * Inject route assets to head html
   */
  public injectAssets({ routerContext, matches, html, isSpa }: IInjectAssetsContext): Headers {
    const assets = this.getAssets(matches ?? routerContext?.matches, isSpa);
    const htmlAssets = assets
      .map(({ type, url, isPreload, content = '' }) => {
        switch (type) {
          case AssetType.style:
            return this.isDev
              ? `<style data-vite-dev-id="${url}">${content}</style>`
              : `<link rel="stylesheet" href="${url}">`;

          case AssetType.script:
            return isPreload
              ? this.modulePreload || isSpa
                ? // can reduce lighthouse performance
                  `<link rel="modulepreload" as="script" crossorigin href="${url}">`
                : null
              : `<script async type="module" crossorigin src="${url}"></script>`;
        }

        return null;
      })
      .filter(Boolean);

    html.header = html.header.replace('</head>', `${htmlAssets.join('\n')}</head>`);

    return this.getEarlyHints(assets);
  }
}

export { AssetType };

export type { IAsset, TAssets };

export default RouteAssets;
