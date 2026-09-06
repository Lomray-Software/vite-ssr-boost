import { readFile } from 'node:fs/promises';
import type { ICreateHandlerOptions, IHtmlShell } from '@core/handler';
import { splitHtmlShell } from '@services/diagnostics';
import createAssetPreparer from '@services/route-asset-preparer';
import RouteAssets from '@services/route-assets';
import type { TRouteAssetsManifest } from '@services/route-assets';

interface ILoadHtmlShellOptions {
  indexFile: string;
  outlet?: string;
}

type IRouteAssetPreparerOptions = (
  { buildDir: string; manifest?: never } | { manifest: TRouteAssetsManifest; buildDir?: never }
) & { modulePreload?: boolean };

/**
 * Read a built document once and supply a fresh shell for each request.
 */
const loadHtmlShell = async ({
  indexFile,
  outlet = '<!--ssr-outlet-->',
}: ILoadHtmlShellOptions): Promise<() => IHtmlShell> => {
  const html = await readFile(indexFile, 'utf8');
  const [header, footer] = splitHtmlShell(html, indexFile, outlet);

  return () => ({ header, footer });
};

/**
 * Inject matched route assets using a manifest cache owned by this preparer.
 */
const createRouteAssetPreparer = <TAppProps = Record<string, any>>({
  buildDir,
  manifest,
  modulePreload = false,
}: IRouteAssetPreparerOptions): NonNullable<ICreateHandlerOptions<TAppProps>['prepare']> => {
  return createAssetPreparer(new RouteAssets(manifest ?? buildDir, modulePreload));
};

export { createRouteAssetPreparer, loadHtmlShell };

export type { IHtmlShell, ILoadHtmlShellOptions, IRouteAssetPreparerOptions, TRouteAssetsManifest };
