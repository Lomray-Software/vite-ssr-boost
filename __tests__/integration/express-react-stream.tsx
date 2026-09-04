// @vitest-environment node
import http from 'node:http';
import { createGunzip } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { PropsWithChildren } from 'react';
import React, { Suspense } from 'react';
import express from 'express';
import compression from 'compression';
import { redirect } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import StreamError from '@constants/stream-error';
import entry from '@node/entry';

interface IResource {
  read: () => void;
}

interface IWireResponse {
  body: string;
  headers: http.IncomingHttpHeaders;
  statusCode: number;
}

let resource: IResource;

const AsyncContent = () => {
  resource.read();

  return <p data-async-content>ready</p>;
};
const RecoverablePage = () => (
  <Suspense fallback={<p data-suspense-fallback>loading</p>}>
    <AsyncContent />
  </Suspense>
);
const ShellErrorPage = (): never => {
  throw new Error('shell exploded');
};
const App = ({ children }: PropsWithChildren) => <main>{children}</main>;

const createRejectingResource = (): IResource & { reject: () => void } => {
  let error: Error | undefined;
  let rejectResource!: (reason: Error) => void;
  const promise = new Promise<never>((_, reject) => {
    rejectResource = reject;
  });

  return {
    reject: () => {
      error = new Error('stream exploded');
      rejectResource(error);
    },
    read: () => {
      if (error) {
        throw error;
      }

      throw promise;
    },
  };
};

const createResolvingResource = (): IResource & { resolve: () => void } => {
  let isReady = false;
  let resolveResource!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveResource = resolve;
  });

  return {
    resolve: () => {
      isReady = true;
      resolveResource();
    },
    read: () => {
      if (!isReady) {
        throw promise;
      }
    },
  };
};

describe('Express real React stream contract', () => {
  const onError = vi.fn();
  const logger = { error: vi.fn(), info: vi.fn() };
  const multipartAction = vi.fn(async ({ request }: { request: Request }) => {
    expect((await request.formData()).get('name')).toBe('Alice');
    return null;
  });
  let port: number;
  let server: http.Server;

  const request = (
    pathname: string,
    gzip = false,
    onFirstHtml?: () => void,
  ): Promise<IWireResponse> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          agent: false,
          headers: gzip ? { 'Accept-Encoding': 'gzip' } : {},
          host: '127.0.0.1',
          path: pathname,
          port,
        },
        (res) => {
          let body = '';
          let hasHtml = false;

          const decoded = gzip ? res.pipe(createGunzip()) : res;
          decoded.setEncoding('utf8');
          decoded.on('data', (chunk: string) => {
            body += chunk;

            if (!hasHtml) {
              hasHtml = true;
              onFirstHtml?.();
            }
          });
          decoded.on('end', () => {
            resolve({
              body,
              headers: res.headers,
              statusCode: res.statusCode!,
            });
          });
          res.on('error', reject);
          decoded.on('error', reject);
        },
      );

      req.on('error', reject);
      req.end();
    });

  beforeAll(async () => {
    const prepared = entry(App, [
      { path: '/timeout', Component: RecoverablePage },
      { path: '/disconnect', Component: RecoverablePage },
      { path: '/multipart', action: multipartAction, Component: () => <p>multipart rendered</p> },
      {
        path: '/login',
        loader: () => {
          const headers = new Headers({ 'Cache-Control': 'no-store' });

          headers.append('Set-Cookie', 'session=one; Path=/; HttpOnly');
          headers.append('Set-Cookie', 'theme=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/');

          return redirect('/streaming', { headers, status: 303 });
        },
      },
      {
        path: '/recoverable',
        Component: RecoverablePage,
      },
      {
        path: '/streaming',
        Component: RecoverablePage,
      },
      {
        path: '/shell-error',
        Component: ShellErrorPage,
      },
    ]);
    const config = {
      getLogger: () => logger,
      getParams: () => ({
        root: process.cwd(),
      }),
      getVite: () => undefined,
      isModulePreload: false,
    };
    const app = express().disable('x-powered-by');

    app.use(compression({ threshold: 0 }));
    app.use(express.raw({ type: 'multipart/form-data' }));
    app.use((req, _, next) => {
      if (req.path === '/multipart') {
        // Model middleware such as multer: the original stream has been consumed.
        req.body = { name: 'Alice' };
      }
      next();
    });

    app.use((req, res) => {
      void prepared.render(
        config as never,
        {
          appProps: {},
          html: {
            footer: '</div><footer data-fixture-footer>footer</footer></body></html>',
            header: '<!doctype html><html><head></head><body><div id="root">',
          },
          req,
          res,
        },
        {
          abortDelay: req.path === '/timeout' ? 50 : 2_000,
          ...(req.path === '/multipart'
            ? {
                getBody: () => {
                  const body = new FormData();
                  body.append('name', req.body.name);
                  return body;
                },
              }
            : {}),
          onError,
          onShellError: ({ error }) => `<!doctype html><p data-shell-error>${error.message}</p>`,
        },
      );
    });

    server = http.createServer(app).listen(0, '127.0.0.1');

    if (!server.listening) {
      await new Promise<void>((resolve) => server.once('listening', resolve));
    }

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('flushes the shell before deferred content resolves', async () => {
    const deferred = createResolvingResource();
    resource = deferred;

    // Complete Suspense only after the client receives HTML, independent of runner speed.
    const response = await request('/streaming', false, deferred.resolve);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('data-suspense-fallback');
    expect(response.body).toContain('data-async-content');
    expect(response.body).toContain('data-fixture-footer');
  });

  it('flushes usable HTML through gzip before deferred content resolves', async () => {
    const deferred = createResolvingResource();
    resource = deferred;

    const response = await request('/streaming', true, deferred.resolve);

    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.body).toContain('data-async-content');
    expect(response.body).toContain('data-fixture-footer');
  });

  it('completes the document with React recovery instructions after a post-flush error', async () => {
    const deferred = createRejectingResource();
    resource = deferred;
    onError.mockClear();

    const response = await request('/recoverable', false, deferred.reject);

    expect(response.statusCode).toBe(200);
    expect(onError).toHaveBeenCalledOnce();
    expect(response.body).toContain('data-suspense-fallback');
    expect(response.body).toContain('data-fixture-footer');
    expect(response.body).toContain('$RX(');
  });

  it('returns 500 for a real React shell error before flush', async () => {
    const response = await request('/shell-error');

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('<p data-shell-error>shell exploded</p>');
    expect(response.body).not.toContain('data-fixture-footer');
  });

  it('preserves cookies and cache headers on loader redirects', async () => {
    const response = await request('/login');

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/streaming');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toEqual([
      'session=one; Path=/; HttpOnly',
      'theme=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
    ]);
  });

  it('logs a real React timeout at info level with the timeout hook code', async () => {
    const pending = new Promise<never>(() => undefined);
    resource = {
      read: () => {
        throw pending;
      },
    };
    onError.mockClear();
    logger.error.mockClear();
    logger.info.mockClear();

    const response = await request('/timeout');

    expect(response.body).toContain('data-fixture-footer');
    expect(onError).toHaveBeenCalled();
    expect(
      onError.mock.calls.every(([{ error }]) => error.code === StreamError.RenderTimeout),
    ).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it('logs a real client disconnect at info level with the cancellation hook code', async () => {
    const pending = new Promise<never>(() => undefined);
    resource = {
      read: () => {
        throw pending;
      },
    };
    onError.mockClear();
    logger.error.mockClear();
    logger.info.mockClear();
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/disconnect`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => undefined);

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls.every(([{ error }]) => error.code === StreamError.RenderCancel)).toBe(
      true,
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it('accepts getBody for multipart parsed before legacy SSR', async () => {
    const body = new FormData();
    body.append('name', 'Alice');
    const response = await fetch(`http://127.0.0.1:${port}/multipart`, { body, method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('multipart rendered');
    expect(multipartAction).toHaveBeenCalledOnce();
  });
});
