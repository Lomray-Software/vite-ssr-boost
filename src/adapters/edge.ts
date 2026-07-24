import compressResponse from '@adapters/compression';
import type { TCompression } from '@adapters/compression';
import type { TSsrHandler } from '@core/types';

export interface IEdgeAdapterOptions {
  compression?: TCompression;
}

export type TEdgeHandler<TPlatformArgs extends unknown[] = unknown[]> = (
  request: Request,
  ...platformArgs: TPlatformArgs
) => Promise<Response>;

const adapterEdge = <TPlatformArgs extends unknown[] = unknown[]>(
  handler: TSsrHandler,
  { compression = false }: IEdgeAdapterOptions = {},
): TEdgeHandler<TPlatformArgs> => {
  return async (request, ...platformArgs) => {
    void platformArgs;

    return compressResponse(request, await handler(request), compression);
  };
};

export default adapterEdge;
