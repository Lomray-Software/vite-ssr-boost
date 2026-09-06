import type { ICreateHandlerOptions } from '@core/handler';
import type RouteAssets from '@services/route-assets-memory';

/**
 * Share route injection across runtimes, computing hints only for supported transports.
 */
const createAssetPreparer = <TAppProps = Record<string, any>>(
  assets: RouteAssets,
): NonNullable<ICreateHandlerOptions<TAppProps>['prepare']> => {
  return async ({ context, executionContext }) => {
    const hints = assets.injectAssets(context, Boolean(executionContext?.onEarlyHints));

    if (hints.has('Link')) {
      await executionContext?.onEarlyHints?.(hints);
    }
  };
};

export default createAssetPreparer;
