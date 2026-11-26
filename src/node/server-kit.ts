import { readFile } from 'node:fs/promises';
import { STATUS_CODES } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerOptions as HttpsServerOptions } from 'node:https';
import path from 'node:path';
import { isEntry } from '@core/entry';
import type { IEntry } from '@core/entry';

type TNext = (error?: unknown) => void;

/**
 * Connect-style middleware: answer the request or pass it on.
 */
type TMiddleware = (req: IncomingMessage, res: ServerResponse, next: TNext) => void;

interface IErrorLogger {
  error: (message: string, options?: { error?: Error }) => void;
}

/**
 * Headers a file response set for its own body, which an error body must not carry.
 */
const ENTITY_HEADERS = [
  'Accept-Ranges',
  'Content-Encoding',
  'Content-Language',
  'Content-Length',
  'Content-Range',
  'ETag',
  'Last-Modified',
  'Trailer',
  'Transfer-Encoding',
];

/**
 * Framing headers an error never takes from its own headers, since the error body replaces the entity.
 */
const FRAMING_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'trailer',
  'transfer-encoding',
]);

/**
 * Final answer for errors no middleware handled, keeping the client status of file errors.
 * Entity headers already set (validators, ranges, encoding, length, trailers) are dropped,
 * and a client error's own headers, such as the Content-Range of a 416 or a WWW-Authenticate,
 * are applied except framing headers, which describe the error body instead.
 */
const sendError = (res: ServerResponse, error: unknown, logger: IErrorLogger): void => {
  const {
    status,
    statusCode,
    headers: errorHeaders,
  } = (error ?? {}) as { status?: number; statusCode?: number; headers?: unknown };
  const code = status ?? statusCode;
  const httpStatus = code && code >= 400 && code < 600 ? code : 500;

  if (httpStatus >= 500) {
    logger.error(`Failed to handle request: ${(error as Error)?.message}`, {
      error: error as Error,
    });
  }

  if (res.headersSent) {
    res.destroy();

    return;
  }

  for (const name of ENTITY_HEADERS) {
    res.removeHeader(name);
  }

  // Server errors keep their details private, so only client errors forward headers.
  if (httpStatus < 500 && errorHeaders && typeof errorHeaders === 'object') {
    for (const [name, value] of Object.entries(errorHeaders as Record<string, string>)) {
      if (!FRAMING_HEADERS.has(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    }
  }

  const body = STATUS_CODES[httpStatus] ?? '';

  res
    .writeHead(httpStatus, {
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'Content-Type': 'text/plain; charset=utf-8',
    })
    .end(body);
};

/**
 * Run middlewares in order; the first error or the end of the chain reaches sendError.
 */
const createRequestListener =
  (middlewares: (TMiddleware | undefined)[], logger: IErrorLogger) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    const chain = middlewares.filter(Boolean) as TMiddleware[];

    /**
     * Advance to the middleware at index, or fail on an error.
     */
    const run = (index: number, error?: unknown): void => {
      if (error) {
        sendError(res, error, logger);

        return;
      }

      const middleware = chain[index];

      if (!middleware) {
        sendError(res, Object.assign(new Error('Not Found'), { status: 404 }), logger);

        return;
      }

      try {
        middleware(req, res, (nextError) => run(index + 1, nextError));
      } catch (thrown) {
        sendError(res, thrown, logger);
      }
    };

    run(0);
  };

/**
 * Inline PEM values carry their own armour; anything else is a path to read.
 */
const INLINE_PEM = /-----BEGIN /;

/**
 * Read one TLS file option, keeping inline PEM values and naming the file that failed.
 */
const readTlsValue = async <T>(name: string, value: T): Promise<T | Buffer> => {
  if (typeof value !== 'string' || INLINE_PEM.test(value)) {
    return value;
  }

  const file = path.resolve(value);

  try {
    return await readFile(file);
  } catch (error) {
    throw new Error(`[ssr-boost] Could not read the HTTPS ${name} file: ${file}`, {
      cause: error,
    });
  }
};

/**
 * Resolve Vite-style HTTPS options, where ca, cert, key and pfx may be file paths.
 */
const resolveTlsOptions = async (
  https: HttpsServerOptions | undefined,
): Promise<HttpsServerOptions | undefined> => {
  if (!https) {
    return undefined;
  }

  const [ca, cert, key, pfx] = await Promise.all([
    readTlsValue('ca', https.ca),
    readTlsValue('cert', https.cert),
    readTlsValue('key', https.key),
    readTlsValue('pfx', https.pfx),
  ]);

  return { ...https, ca, cert, key, pfx };
};

/**
 * Take the defineEntry() default export of a server module, explaining an Express entry.
 */
const toEntry = (file: string, module: unknown): IEntry => {
  const entry = (module as { default?: unknown } | undefined)?.default;

  if (!isEntry(entry)) {
    throw new Error(
      `[ssr-boost] ${file} has no defineEntry() default export. The node server (managedServer: 'node') needs \`export default defineEntry(App, routes)\`; Express entries run with managedServer: 'express'.`,
    );
  }

  return entry;
};

export { createRequestListener, resolveTlsOptions, sendError, toEntry };

export type { IErrorLogger, TMiddleware, TNext };
