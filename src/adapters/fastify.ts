import type { IncomingMessage, ServerResponse } from 'node:http';
import serializeBody from '@adapters/body';
import type { TCompression } from '@adapters/compression';
import type { TSsrHandler } from '@core/types';
import compressResponse from '@node/compress-response';
import createRequest from '@node/create-request';
import createRequestSignal from '@node/request-signal';
import writeEarlyHints from '@node/write-early-hints';
import writeFetchResponse from '@node/write-fetch-response';

interface IFastifyRequest {
  body?: unknown;
  raw: IncomingMessage;
}

interface IFastifyReply {
  getHeaders?: () => Record<string, string | number | string[] | undefined>;
  hijack: () => void;
  raw: ServerResponse;
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
      const requestBody = options.getBody
        ? (options.getBody(request) ?? null)
        : serializeBody(body, String(req.headers['content-type'] ?? ''));
      const fetchRequest = createRequest(req, {
        body: requestBody,
        signal: requestSignal.signal,
      });
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
    } finally {
      requestSignal.dispose();
    }
  };
};

export type { IFastifyReply, IFastifyRequest, TFastifyHandler };

export default adapterFastify;
