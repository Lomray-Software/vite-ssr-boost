import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TSsrHandler } from '@core/types';
import createRequest from '@node/create-request';
import writeEarlyHints from '@node/write-early-hints';
import writeFetchResponse from '@node/write-fetch-response';

interface IFastifyRequest {
  body?: unknown;
  raw: IncomingMessage;
}

interface IFastifyReply {
  hijack: () => void;
  raw: ServerResponse;
}

type TFastifyHandler = (request: IFastifyRequest, reply: IFastifyReply) => Promise<void>;

const serializeBody = (body: unknown): BodyInit | null => {
  if (body === undefined) {
    return null;
  }

  if (typeof body === 'string' || ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
    return body as BodyInit;
  }

  return JSON.stringify(body);
};

const adapterFastify = (handler: TSsrHandler): TFastifyHandler => {
  return async ({ body, raw: req }, reply) => {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    const onClose = (): void => {
      if (!reply.raw.writableEnded) {
        abort();
      }
    };

    req.once('aborted', abort);
    reply.raw.once('close', onClose);

    try {
      const response = await handler(
        createRequest(req, {
          body: serializeBody(body),
          signal: controller.signal,
        }),
        {
          onEarlyHints: (headers) => writeEarlyHints(reply.raw, headers),
        },
      );

      reply.hijack();
      await writeFetchResponse(reply.raw, response);
    } finally {
      req.off('aborted', abort);
      reply.raw.off('close', onClose);
    }
  };
};

export type { IFastifyReply, IFastifyRequest, TFastifyHandler };

export default adapterFastify;
