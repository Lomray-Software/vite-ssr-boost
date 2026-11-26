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
const ENTITY_HEADERS = ['Content-Encoding', 'Content-Language', 'Content-Length', 'Content-Range'];

/**
 * Final answer for errors no middleware handled, keeping the client status of file errors.
 * Like finalhandler, entity headers already set are dropped and a client error's own
 * headers, such as the Content-Range of a 416, are applied.
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
      res.setHeader(name, value);
    }
  }

  res
    .writeHead(httpStatus, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    })
    .end(STATUS_CODES[httpStatus]);
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
 * Read a file path option the way Vite does, keeping inline PEM values as they are.
 */
const readTlsValue = async <T>(value: T): Promise<T | Buffer> =>
  typeof value === 'string' ? readFile(path.resolve(value)).catch(() => value) : value;

/**
 * Resolve Vite-style HTTPS options, where ca, cert, key and pfx may be file paths.
 */
const resolveTlsOptions = async (
  https: HttpsServerOptions | undefined,
): Promise<HttpsServerOptions | undefined> => {
  if (!https) {
    return undefined;
  }

  const [ca, cert, key, pfx] = await Promise.all(
    [https.ca, https.cert, https.key, https.pfx].map((value) => readTlsValue(value)),
  );

  return { ...https, ca, cert, key, pfx } as HttpsServerOptions;
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
