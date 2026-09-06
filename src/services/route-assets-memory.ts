import type { RouterState, StaticHandlerContext } from 'react-router';

enum AssetType {
  style = 'style',
  script = 'script',
  image = 'image',
  font = 'font',
}

interface IAsset {
  type: string;
  url: string;

  /** Lower weights are injected first. */
  weight: number;

  /** Nested assets follow top-level assets with the same weight. */
  isNested: boolean;
  isPreload: boolean;
  content?: string;
}

type TAssets = { [id: string]: IAsset };

/** Parsed build/client/assets-manifest.json; accepts a JSON module directly. */
type TRouteAssetsManifest = Readonly<Record<string, readonly IAsset[]>>;

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
  /**
   * Control module preload hints for matched scripts.
   */
  protected readonly modulePreload: boolean;

  /**
   * Keep the build's route assets isolated from other handler instances.
   */
  protected routesAssets: TRouteAssetsManifest | null;

  /**
   * Retain the supplied manifest and preload preference.
   */
  constructor(manifest: TRouteAssetsManifest, modulePreload = false) {
    this.routesAssets = manifest;
    this.modulePreload = modulePreload;
  }

  /**
   * Development manifests override this to inject inline styles.
   */
  protected get isDev(): boolean {
    return false;
  }

  /**
   * Build preload hints without depending on a particular HTTP transport.
   */
  public getEarlyHints(assets: IAsset[]): Headers {
    const headers = new Headers();

    /**
     * Advertise only styles and scripts as HTTP preload hints.
     */
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
  public injectAssets(
    { routerContext, matches, html, isSpa }: IInjectAssetsContext,
    earlyHints = true,
  ): Headers {
    const assets = this.getAssets(matches ?? routerContext?.matches, isSpa);

    /**
     * Render each matched style or script using the current runtime's asset mode.
     */
    const htmlAssets = assets
      .map(({ type, url, isPreload, content = '' }) => {
        switch (type) {
          case 'style':
            return this.isDev
              ? `<style data-vite-dev-id="${url}">${content}</style>`
              : `<link rel="stylesheet" href="${url}">`;

          case 'script':
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

    return earlyHints ? this.getEarlyHints(assets) : new Headers();
  }

  /**
   * Read the manifest without requiring a filesystem.
   */
  protected loadAssetsManifest(): TRouteAssetsManifest {
    return this.routesAssets ?? {};
  }

  /**
   * Sort assets
   */
  protected sortAssets(assets: IAsset[]): IAsset[] {
    return assets.sort(({ weight, isNested }, { weight: nextWeight, isNested: isNextNested }) =>
      weight === nextWeight ? Number(isNested) - Number(isNextNested) : weight - nextWeight,
    );
  }

  /**
   * Get route assets
   * The development manifest uses the SPA flag to preload unqueried lazy routes.
   */
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
}

export { AssetType };

export type { IAsset, TAssets, TRouteAssetsManifest };

export default RouteAssets;
