import compressResponse from '@adapters/compression';
import type { TCompression } from '@adapters/compression';
import headResponse from '@core/head-response';
import type { TSsrHandler } from '@core/types';

export interface IEdgeAdapterOptions {
  compression?: TCompression;
}

export type TEdgeHandler<TPlatformArgs extends unknown[] = unknown[]> = (
  request: Request,
  ...platformArgs: TPlatformArgs
) => Promise<Response>;

/**
 * Adapt the Fetch handler to runtime fetch entrypoints and optional compression.
 */
const adapterEdge = <TPlatformArgs extends unknown[] = unknown[]>(
  handler: TSsrHandler,
  { compression = false }: IEdgeAdapterOptions = {},
): TEdgeHandler<TPlatformArgs> => {
  /**
   * Apply compression and HEAD handling to the completed Fetch response.
   */
  return async (...[request]: Parameters<TEdgeHandler<TPlatformArgs>>) => {
    return headResponse(request, compressResponse(request, await handler(request), compression));
  };
};

export default adapterEdge;
