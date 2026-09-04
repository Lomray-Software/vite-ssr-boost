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
import entry from '@node/entry';

interface IResource {
  read: () => void;
}

interface IWireResponse {
  body: string;
  headers: http.IncomingHttpHeaders;
  firstByteAt: number;
  statusCode: number;
}

let resource: IResource;
let resourceSettledAt = 0;

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

const createRejectingResource = (): IResource => {
  let error: Error | undefined;
  const promise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      error = new Error('stream exploded');
      reject(error);
    }, 10);
  });

  return {
    read: () => {
      if (error) {
        throw error;
      }

      throw promise;
    },
  };
};

const createResolvingResource = (): IResource => {
  let isReady = false;
  const promise = new Promise<void>((resolve) => {
    setTimeout(() => {
      isReady = true;
      resourceSettledAt = performance.now();
      resolve();
    }, 100);
  });

  return {
    read: () => {
      if (!isReady) {
        throw promise;
      }
    },
  };
};

describe('Express real React stream contract', () => {
  const onError = vi.fn();
  let port: number;
  let server: http.Server;

  const request = (pathname: string, gzip = false): Promise<IWireResponse> =>
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
          let firstByteAt = 0;

          const decoded = gzip ? res.pipe(createGunzip()) : res;
          decoded.setEncoding('utf8');
          decoded.on('data', (chunk: string) => {
            firstByteAt ||= performance.now();
            body += chunk;
          });
          decoded.on('end', () => {
            resolve({
              body,
              headers: res.headers,
              firstByteAt,
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
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
    };
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
          abortDelay: 2_000,
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
    resource = createResolvingResource();
    resourceSettledAt = 0;

    const response = await request('/streaming');

    expect(response.statusCode).toBe(200);
    expect(response.firstByteAt).toBeLessThan(resourceSettledAt);
    expect(response.body).toContain('data-suspense-fallback');
    expect(response.body).toContain('data-async-content');
    expect(response.body).toContain('data-fixture-footer');
  });

  it('flushes usable HTML through gzip before deferred content resolves', async () => {
    resource = createResolvingResource();
    resourceSettledAt = 0;

    const response = await request('/streaming', true);

    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.firstByteAt).toBeLessThan(resourceSettledAt);
    expect(response.body).toContain('data-async-content');
    expect(response.body).toContain('data-fixture-footer');
  });

  it('completes the document with React recovery instructions after a post-flush error', async () => {
    resource = createRejectingResource();
    onError.mockClear();

    const response = await request('/recoverable');

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
});
