import serializeBody from '@adapters/body';
import type { TCompression } from '@adapters/compression';
import type { TSsrHandler } from '@core/types';
import compressResponse from '@node/compress-response';
import createRequest from '@node/create-request';
import type { TIncomingMessage, TServerResponse } from '@node/http';
import createRequestSignal from '@node/request-signal';
import writeEarlyHints from '@node/write-early-hints';
import writeFetchResponse from '@node/write-fetch-response';

interface IFastifyRequest {
  body?: unknown;
  raw: TIncomingMessage;
}

interface IFastifyReply {
  getHeaders?: () => Record<string, string | number | string[] | undefined>;
  hijack: () => void;
  raw: TServerResponse;
}

type TFastifyHandler = (request: IFastifyRequest, reply: IFastifyReply) => Promise<void>;

export interface IFastifyAdapterOptions {
  compression?: TCompression;
  getBody?: (request: IFastifyRequest) => BodyInit | null | undefined;
}

const adapterFastify = (
  handler: TSsrHandler,
  options: IFastifyAdapterOptions = {},
): TFastifyHandler => {
  return async (request, reply) => {
    const { body, raw: req } = request;
    const requestSignal = createRequestSignal(req, reply.raw);

    try {
      const requestOptions: { body?: BodyInit | null; signal: AbortSignal } = {
        signal: requestSignal.signal,
      };

      if (options.getBody) {
        requestOptions.body = options.getBody(request) ?? null;
      } else if (body !== undefined) {
        requestOptions.body = serializeBody(body, String(req.headers['content-type'] ?? ''));
      }

      const fetchRequest = createRequest(req, requestOptions);
      const response = compressResponse(
        fetchRequest,
        await handler(fetchRequest, {
          onEarlyHints: (headers) => writeEarlyHints(reply.raw, headers),
        }),
        options.compression,
      );

      // Fastify keeps reply.header() values separately from the raw Node response.
      Object.entries(reply.getHeaders?.() ?? {}).forEach(([name, value]) => {
        if (value !== undefined) {
          reply.raw.setHeader(name, value);
        }
      });
      reply.hijack();
      await writeFetchResponse(reply.raw, response);
    } catch (error) {
      if (!requestSignal.signal.aborted) {
        throw error;
      }

      // The socket is gone; prevent Fastify from attempting an automatic response.
      reply.hijack();
    } finally {
      requestSignal.dispose();
    }
  };
};

export type { IFastifyReply, IFastifyRequest, TFastifyHandler };

export default adapterFastify;
