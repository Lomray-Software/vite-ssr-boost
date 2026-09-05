import { Readable, Writable } from 'node:stream';
import { constants, createDeflate, createGzip } from 'node:zlib';
import compressResponse from '@adapters/compression';
import type { TCompression } from '@adapters/compression';

/**
 * Flush each compressed chunk so browsers can render the shell while React is suspended.
 */
const compressNodeResponse = (
  request: Request,
  response: Response,
  compression?: TCompression,
): Response =>
  compressResponse(request, response, compression, (format) => {
    const create = format === 'gzip' ? createGzip : createDeflate;
    const stream = create({ flush: constants.Z_SYNC_FLUSH });

    return {
      readable: Readable.toWeb(stream, {
        strategy: {
          highWaterMark: stream.readableHighWaterMark,
          size: (chunk: Uint8Array) => chunk.byteLength,
        },
      }),
      writable: Writable.toWeb(stream),
    } as ReadableWritablePair<Uint8Array, Uint8Array>;
  });

export default compressNodeResponse;
