// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { createRequestListener, resolveTlsOptions } from '@node/server-kit';
import type { TMiddleware } from '@node/server-kit';

const servers: http.Server[] = [];
const tempDirs: string[] = [];

/**
 * Serve a request listener built from the middlewares on a random port.
 */
const serve = async (
  middlewares: (TMiddleware | undefined)[],
  logger: { error: Mock<(message: string) => void> } = { error: vi.fn() },
): Promise<string> => {
  const server = http.createServer(createRequestListener(middlewares, logger));

  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

/**
 * Fetch a URL and read status, cache header and body.
 */
const request = async (
  url: string,
): Promise<{ status: number; cacheControl: string | null; body: string }> => {
  const response = await fetch(url);

  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: await response.text(),
  };
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('node/server-kit', () => {
  describe('createRequestListener', () => {
    it('should run middlewares in order and skip undefined entries', async () => {
      const calls: string[] = [];
      const url = await serve([
        (_req, _res, next) => {
          calls.push('first');
          next();
        },
        undefined,
        (_req, res) => {
          calls.push('second');
          res.end('done');
        },
      ]);

      const result = await request(`${url}/page`);

      expect(result).toMatchObject({ status: 200, body: 'done' });
      expect(calls).toEqual(['first', 'second']);
    });

    it('should answer 404 with no-store when the chain falls through', async () => {
      const logger = { error: vi.fn<(message: string) => void>() };
      const url = await serve([(_req, _res, next) => next()], logger);

      const result = await request(`${url}/missing`);

      expect(result).toEqual({ status: 404, cacheControl: 'no-store', body: 'Not Found' });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should answer 500 and log when a middleware throws', async () => {
      const logger = { error: vi.fn<(message: string) => void>() };
      const url = await serve(
        [
          () => {
            throw new Error('boom');
          },
        ],
        logger,
      );

      const result = await request(url);

      expect(result).toEqual({
        status: 500,
        cacheControl: 'no-store',
        body: 'Internal Server Error',
      });
      expect(logger.error).toHaveBeenCalledWith('Failed to handle request: boom', {
        error: expect.any(Error),
      });
    });

    it('should keep a client error status passed to next without logging', async () => {
      const logger = { error: vi.fn<(message: string) => void>() };
      const url = await serve(
        [(_req, _res, next) => next(Object.assign(new Error('Bad'), { statusCode: 400 }))],
        logger,
      );

      const result = await request(url);

      expect(result).toMatchObject({ status: 400, body: 'Bad Request' });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should stop at the first error and never run later middlewares', async () => {
      const later = vi.fn();
      const url = await serve([(_req, _res, next) => next(new Error('fail')), later]);

      const result = await request(url);

      expect(result.status).toBe(500);
      expect(later).not.toHaveBeenCalled();
    });

    it('should drop entity headers and apply a client error own headers', async () => {
      const url = await serve([
        (_req, res, next) => {
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Content-Length', '999');
          res.setHeader('Content-Language', 'en');
          res.setHeader('ETag', 'W/"file"');
          next(
            Object.assign(new Error('Range Not Satisfiable'), {
              status: 416,
              headers: { 'Content-Range': 'bytes */12' },
            }),
          );
        },
      ]);

      const response = await fetch(url);

      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe('bytes */12');
      expect(response.headers.get('content-encoding')).toBeNull();
      expect(response.headers.get('content-language')).toBeNull();
      expect(response.headers.get('etag')).toBe('W/"file"');
      expect(await response.text()).toBe('Range Not Satisfiable');
    });

    it('should not forward the headers of a server error', async () => {
      const url = await serve([
        (_req, _res, next) =>
          next(Object.assign(new Error('boom'), { headers: { 'X-Debug': '1' } })),
      ]);

      const response = await fetch(url);

      expect(response.status).toBe(500);
      expect(response.headers.get('x-debug')).toBeNull();
    });

    it('should destroy the socket when the error comes after headers were sent', async () => {
      let serverResponse: http.ServerResponse | undefined;
      const url = await serve([
        (_req, res, next) => {
          serverResponse = res;
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.write('partial');
          next(new Error('late'));
        },
      ]);

      await expect(fetch(url).then((response) => response.text())).rejects.toThrow();
      expect(serverResponse?.destroyed).toBe(true);
      expect(serverResponse?.writableFinished).toBe(false);
    });
  });

  describe('resolveTlsOptions', () => {
    it('should return undefined without https options', async () => {
      expect(await resolveTlsOptions(undefined)).toBeUndefined();
    });

    it('should read file paths and keep inline values', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'ssr-boost-tls-test-'));
      const keyFile = path.join(dir, 'key.pem');

      tempDirs.push(dir);
      await writeFile(keyFile, 'KEY FROM FILE');

      const inlineCert = '-----BEGIN CERTIFICATE-----\ninline\n-----END CERTIFICATE-----';
      const result = await resolveTlsOptions({
        key: keyFile,
        cert: inlineCert,
        passphrase: 'secret-phrase',
      });

      expect(Buffer.isBuffer(result?.key)).toBe(true);
      expect(result?.key?.toString()).toBe('KEY FROM FILE');
      expect(result?.cert).toBe(inlineCert);
      expect(result?.passphrase).toBe('secret-phrase');
      expect(result?.ca).toBeUndefined();
    });

    it('should name a TLS file that cannot be read instead of using the path as a value', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'ssr-boost-tls-test-'));
      const missing = path.join(dir, 'missing-cert.pem');

      tempDirs.push(dir);

      await expect(resolveTlsOptions({ cert: missing })).rejects.toThrow(
        `[ssr-boost] Could not read the HTTPS cert file: ${missing}`,
      );
    });

    it('should pass buffers through unchanged', async () => {
      const key = Buffer.from('buffer key');

      const result = await resolveTlsOptions({ key });

      expect(result?.key).toBe(key);
    });
  });
});
