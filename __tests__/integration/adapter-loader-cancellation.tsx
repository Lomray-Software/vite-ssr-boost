// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import Fastify from 'fastify';
import { createStaticHandler } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import adapterExpress from '@adapters/express';
import adapterFastify from '@adapters/fastify';
import adapterNode from '@adapters/node';
import createHandler from '@core/handler';
import type { TSsrHandler } from '@core/types';
import nodeRenderToStream from '@node/render-to-stream';

interface IRuntime {
  close: () => Promise<void>;
  origin: string;
}

type TStart = (handler: TSsrHandler, onError: (error: unknown) => void) => Promise<IRuntime>;

const listen = async (server: http.Server): Promise<IRuntime> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
};

const runtimes: { name: string; start: TStart }[] = [
  {
    name: 'Node',
    start: (handler, onError) =>
      listen(
        http.createServer((req, res) => {
          void adapterNode(handler)(req, res, (error) => {
            onError(error);
            res.statusCode = 500;
            res.end('failed');
          });
        }),
      ),
  },
  {
    name: 'Express',
    start: (handler, onError) => {
      const app = express();

      app.use(adapterExpress(handler));
      app.use(
        (
          error: Error,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ) => {
          onError(error);
          res.status(500).end('failed');
        },
      );

      return listen(http.createServer(app));
    },
  },
  {
    name: 'Fastify',
    start: async (handler, onError) => {
      const app = Fastify({ forceCloseConnections: true });

      app.setErrorHandler((error, _req, reply) => {
        onError(error);
        void reply.status(500).send('failed');
      });
      app.all('/*', adapterFastify(handler));

      return {
        close: () => app.close(),
        origin: await app.listen({ host: '127.0.0.1', port: 0 }),
      };
    },
  },
];

describe.each(runtimes)('$name loader cancellation', ({ start }) => {
  it('settles a disconnected loader without forwarding an error, and still forwards real failures', async () => {
    let onStarted: () => void;
    const started = new Promise<void>((resolve) => {
      onStarted = resolve;
    });
    const aborted = vi.fn();
    const settled = vi.fn();
    const onError = vi.fn();
    const failure = new Error('real handler failure');
    const handler = createHandler(
      {
        createApp: (children) => children,
        handler: createStaticHandler([
          {
            path: '/slow',
            loader: async ({ request }) => {
              onStarted();
              await new Promise<void>((resolve) => {
                request.signal.addEventListener(
                  'abort',
                  () => {
                    aborted();
                    resolve();
                  },
                  { once: true },
                );
              });

              return null;
            },
          },
        ]),
        renderToStream: nodeRenderToStream,
      },
      { getHtml: () => ({ header: '', footer: '' }) },
    );
    const runtime = await start(async (request) => {
      if (new URL(request.url).pathname === '/error') {
        throw failure;
      }

      try {
        return await handler(request);
      } finally {
        settled();
      }
    }, onError);
    const client = http.get(`${runtime.origin}/slow`);

    client.on('error', () => undefined);

    try {
      await started;
      client.destroy();
      await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
      expect(aborted).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();

      const response = await fetch(`${runtime.origin}/error`);

      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toBe('failed');
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    } finally {
      client.destroy();
      await runtime.close();
    }
  });
});
