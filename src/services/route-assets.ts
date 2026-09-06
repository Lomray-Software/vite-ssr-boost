import fs from 'node:fs';
import path from 'node:path';
import MemoryRouteAssets from '@services/route-assets-memory';
import type { TRouteAssetsManifest } from '@services/route-assets-memory';

/**
 * Keep the Node manifest cache while also accepting a parsed JSON manifest.
 */
class RouteAssets extends MemoryRouteAssets {
  protected readonly outputDir: string;

  constructor(buildDir: string | TRouteAssetsManifest, modulePreload = false) {
    super(typeof buildDir === 'string' ? {} : buildDir, modulePreload);
    this.outputDir = typeof buildDir === 'string' ? path.resolve(buildDir) : '';
    this.routesAssets = typeof buildDir === 'string' ? null : buildDir;
  }

  /**
   * Get assets manifest file name.
   */
  protected getAssetsManifestFile(): string {
    return path.join(this.outputDir, 'server', 'assets-manifest.json');
  }

  /**
   * Load and cache the Node manifest on first use.
   */
  protected loadAssetsManifest(): TRouteAssetsManifest {
    if (this.routesAssets !== null) {
      return this.routesAssets;
    }

    const manifestFile = this.getAssetsManifestFile();

    if (!fs.existsSync(manifestFile)) {
      return {};
    }

    this.routesAssets = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as TRouteAssetsManifest;

    return this.routesAssets;
  }
}

export { AssetType } from '@services/route-assets-memory';

export type { IAsset, TAssets, TRouteAssetsManifest } from '@services/route-assets-memory';

export default RouteAssets;
