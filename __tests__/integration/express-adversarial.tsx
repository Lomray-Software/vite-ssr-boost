// @vitest-environment node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { PropsWithChildren } from 'react';
import React from 'react';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import entry from '@node/entry';
import createServer from '@node/server';
import splitLinkHeader from '@node/split-link-header';

type TScenario =
  | 'backpressure'
  | 'cookies'
  | 'disconnect'
  | 'early-hints'
  | 'fatal'
  | 'headers-sent'
  | 'normal'
  | 'recoverable'
  | 'shell-error'
  | 'split-utf8'
  | 'timeout';

interface IRenderCallbacks {
  onAllReady: () => void;
  onError: (error: unknown) => void;
  onShellError: (error: Error) => void;
  onShellReady: () => void;
}

interface IDestination {
  destroy: (error?: Error) => void;
  end: () => void;
  once: (event: string, callback: () => void) => void;
  write: (chunk: string | Uint8Array) => boolean;
}

interface IWireResponse {
  body: Buffer;
  headers: http.IncomingHttpHeaders;
  information: http.InformationEvent[];
  rawHeaders: string[];
  statusCode: number;
}

const fixture = vi.hoisted(() => ({
  abortCount: 0,
  abortResolve: undefined as (() => void) | undefined,
  backpressureCount: 0,
  drainCount: 0,
  fatalSocketClosed: false,
  headerMutationCode: undefined as string | undefined,
  lastRequestSignal: undefined as AbortSignal | undefined,
  prepareServer: {
    getMiddlewaresConfig: vi.fn(() => ({
      compression: false,
      expressStatic: false,
    })),
    loadEntrypoint: vi.fn(),
    loadHtml: vi.fn(async () => [
      '<!doctype html><html><head></head><body><div id="root">',
      '</div><footer data-fixture-footer>footer</footer></body></html>',
    ]),
    onAppCreated: vi.fn(async () => undefined),
    onServerStarted: vi.fn(),
  },
  recoverableErrorCount: 0,
  renderToPipeableStream: vi.fn(),
  scenario: 'normal' as TScenario,
}));

vi.mock('react-dom/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom/server')>()),
  renderToPipeableStream: fixture.renderToPipeableStream,
}));

vi.mock('@services/prepare-server', () => ({
  default: {
    init: vi.fn(() => fixture.prepareServer),
  },
}));

const App = ({ children }: PropsWithChildren) => children;
const complete = (destination: IDestination, callbacks: IRenderCallbacks): void => {
  destination.write('<span data-final-chunk>final</span>');
  callbacks.onAllReady();
  destination.end();
};

const pipeScenario = (
  scenario: TScenario,
  destination: IDestination,
  callbacks: IRenderCallbacks,
): void => {
  switch (scenario) {
    case 'split-utf8': {
      const emoji = Buffer.from('🙂');

      destination.write('<main data-transform="ORIGINAL">');
      destination.write(Buffer.concat([Buffer.from('before-'), emoji.subarray(0, 2)]));
      destination.write(Buffer.concat([emoji.subarray(2), Buffer.from('-after</main>')]));
      queueMicrotask(() => complete(destination, callbacks));
      break;
    }

    case 'disconnect':
      destination.write('<main data-shell>disconnect</main>');
      break;

    case 'backpressure': {
      const chunk = Buffer.alloc(64 * 1024, 'x');
      let written = 0;
      const pump = (): void => {
        while (written < 32) {
          written += 1;

          if (!destination.write(chunk)) {
            fixture.backpressureCount += 1;
            destination.once('drain', () => {
              fixture.drainCount += 1;
              pump();
            });

            return;
          }
        }

        complete(destination, callbacks);
      };

      pump();
      break;
    }

    case 'recoverable':
      destination.write('<main data-shell>recoverable</main>');
      setTimeout(() => {
        callbacks.onError(new Error('recoverable render failure'));
        destination.write('<template data-react-recovery>client fallback</template>');
        complete(destination, callbacks);
      }, 10);
      break;

    case 'fatal':
      destination.write('<main data-shell>fatal</main>');
      setTimeout(() => {
        fixture.fatalSocketClosed = true;
        destination.destroy();
      }, 10);
      break;

    default:
      destination.write('<main data-shell>shell</main>');
      queueMicrotask(() => complete(destination, callbacks));
  }
};

fixture.renderToPipeableStream.mockImplementation((_: unknown, callbacks: IRenderCallbacks) => {
  const scenario = fixture.scenario;
  let destination: IDestination | undefined;
  let hasAborted = false;

  if (scenario === 'shell-error') {
    queueMicrotask(() => callbacks.onShellError(new Error('shell failed')));
  } else if (scenario !== 'timeout') {
    queueMicrotask(callbacks.onShellReady);
  }

  return {
    abort: () => {
      if (hasAborted) {
        return;
      }

      hasAborted = true;
      fixture.abortCount += 1;
      fixture.abortResolve?.();

      if (scenario === 'timeout') {
        callbacks.onShellError(new Error('render timed out'));
      } else {
        destination?.destroy();
      }
    },
    pipe: (target: IDestination) => {
      destination = target;
      pipeScenario(scenario, target, callbacks);
    },
  };
});

const getHeaderValues = (rawHeaders: string[], name: string): string[] => {
  const values: string[] = [];

  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name.toLowerCase()) {
      values.push(rawHeaders[index + 1]!);
    }
  }

  return values;
};

describe('Express adversarial contract', () => {
  let fixtureDir: string;
  let port: number;
  let server: http.Server;

  const request = (pathname: string): Promise<IWireResponse> =>
    new Promise((resolve, reject) => {
      const information: http.InformationEvent[] = [];
      const req = http.request(
        {
          agent: false,
          host: '127.0.0.1',
          path: pathname,
          port,
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              body: Buffer.concat(chunks),
              headers: res.headers,
              information,
              rawHeaders: res.rawHeaders,
              statusCode: res.statusCode!,
            });
          });
          res.on('error', reject);
        },
      );

      req.on('information', (info) => information.push(info));
      req.on('error', reject);
      req.end();
    });

  beforeAll(async () => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-ssr-boost-express-'));
    fs.mkdirSync(path.join(fixtureDir, 'server'));
    fs.writeFileSync(
      path.join(fixtureDir, 'server/assets-manifest.json'),
      JSON.stringify({
        root: [
          {
            isNested: false,
            isPreload: false,
            type: 'style',
            url: '/fixture.css',
            weight: 1,
          },
          {
            isNested: false,
            isPreload: true,
            type: 'script',
            url: '/fixture.js',
            weight: 2,
          },
        ],
      }),
    );

    const prepared = entry(
      App,
      [
        {
          id: 'root',
          path: '*',
          loader: ({ request: fetchRequest }) => {
            fixture.lastRequestSignal = fetchRequest.signal;

            return null;
          },
          Component: () => <div>route</div>,
        },
      ],
      {},
    );

    fixture.prepareServer.loadEntrypoint.mockImplementation(async () => ({
      ...prepared,
      abortDelay: 2_000,
      onError: () => {
        fixture.recoverableErrorCount += 1;
      },
      onRequest: (req: ExpressRequest, res: ExpressResponse) => {
        fixture.scenario = req.originalUrl.slice(1).split('?')[0] as TScenario;

        if (fixture.scenario === 'cookies') {
          res.append('Set-Cookie', 'session=one; Path=/; HttpOnly');
          res.append('Set-Cookie', 'expires=two; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/');
        }

        return {
          appProps: {},
          hasEarlyHints: fixture.scenario === 'early-hints',
        };
      },
      onResponse: ({ context, html }: { context: { res: ExpressResponse }; html: string }) => {
        if (fixture.scenario === 'split-utf8') {
          const modified = html.replace('ORIGINAL', 'MODIFIED');

          return modified === html ? undefined : modified;
        }

        if (fixture.scenario === 'headers-sent' && context.res.headersSent) {
          try {
            context.res.setHeader('x-too-late', 'late');
          } catch (error) {
            fixture.headerMutationCode = (error as NodeJS.ErrnoException).code;
          }
        }

        return undefined;
      },
      onShellError: ({ error }: { error: Error }) =>
        `<!doctype html><p data-shell-error>${error.message}</p>`,
      render: (
        config: never,
        context: { req: { originalUrl: string } },
        options: Record<string, unknown>,
      ) =>
        prepared.render(config, context as never, {
          ...options,
          abortDelay: context.req.originalUrl === '/timeout' ? 25 : 2_000,
        }),
    }));

    const logger = {
      error: vi.fn(),
      info: vi.fn(),
    };
    const config = {
      getLogger: () => logger,
      getParams: () => ({
        host: '127.0.0.1',
        isSPA: false,
        port: 0,
        publicDir: 'client',
        root: fixtureDir,
      }),
      getVite: () => undefined,
      isHost: false,
      isModulePreload: false,
      isProd: true,
      mode: 'production',
      setApp: vi.fn(),
    };
    const created = await createServer(config as never);

    server = created.run({ isPrintInfo: false }) as http.Server;

    if (!server.listening) {
      await new Promise<void>((resolve) => server.once('listening', resolve));
    }

    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    fixture.abortCount = 0;
    fixture.abortResolve = undefined;
    fixture.backpressureCount = 0;
    fixture.drainCount = 0;
    fixture.fatalSocketClosed = false;
    fixture.headerMutationCode = undefined;
    fixture.lastRequestSignal = undefined;
    fixture.recoverableErrorCount = 0;
    fixture.scenario = 'normal';
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(fixtureDir, { force: true, recursive: true });
  });

  it('keeps multiple Set-Cookie headers separate', async () => {
    const response = await request('/cookies');

    expect(getHeaderValues(response.rawHeaders, 'set-cookie')).toEqual([
      'session=one; Path=/; HttpOnly',
      'expires=two; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
    ]);
  });

  it('sends 103 Early Hints on the wire before the final response', async () => {
    const response = await request('/early-hints');
    const earlyHints = response.information.find(({ statusCode }) => statusCode === 103);

    expect(earlyHints).toBeDefined();
    expect(
      getHeaderValues(earlyHints!.rawHeaders, 'link').flatMap((value) => splitLinkHeader(value)),
    ).toEqual(['</fixture.css>; rel=preload; as=style', '</fixture.js>; rel=preload; as=script']);
    expect(response.statusCode).toBe(200);
  });

  it('preserves split UTF-8 while transforming another chunk', async () => {
    const response = await request('/split-utf8');

    expect(response.body.toString()).toContain(
      '<main data-transform="MODIFIED">before-🙂-after</main>',
    );
  });

  it('aborts the Fetch request and React render on client disconnect', async () => {
    const aborted = new Promise<void>((resolve) => {
      fixture.abortResolve = resolve;
    });

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          agent: false,
          host: '127.0.0.1',
          path: '/disconnect',
          port,
        },
        (res) => {
          res.once('data', () => {
            res.destroy();
            resolve();
          });
          res.on('error', () => undefined);
        },
      );

      req.on('error', reject);
      req.end();
    });
    await aborted;

    expect(fixture.lastRequestSignal?.aborted).toBe(true);
    expect(fixture.abortCount).toBe(1);
  });

  it('propagates slow-consumer backpressure and keeps the final chunk', async () => {
    const response = await new Promise<IWireResponse>((resolve, reject) => {
      const req = http.request(
        {
          agent: false,
          host: '127.0.0.1',
          path: '/backpressure',
          port,
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.pause();
          setTimeout(() => res.resume(), 50);
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              body: Buffer.concat(chunks),
              headers: res.headers,
              information: [],
              rawHeaders: res.rawHeaders,
              statusCode: res.statusCode!,
            });
          });
          res.on('error', reject);
        },
      );

      req.on('error', reject);
      req.end();
    });

    expect(fixture.backpressureCount).toBeGreaterThan(0);
    expect(fixture.drainCount).toBe(fixture.backpressureCount);
    expect(response.body.toString()).toContain('<span data-final-chunk>final</span>');
    expect(response.body.toString()).toContain('data-fixture-footer');
  });

  it('rejects header mutation after the first flush without truncating the document', async () => {
    const response = await request('/headers-sent');
    const html = response.body.toString();

    expect(fixture.headerMutationCode).toBe('ERR_HTTP_HEADERS_SENT');
    expect(response.headers['x-too-late']).toBeUndefined();
    expect(html).toContain('data-fixture-footer');
    expect(html).toContain('data-final-chunk');
  });

  it('keeps the footer and final streamed chunk', async () => {
    const response = await request('/normal');
    const html = response.body.toString();

    expect(html).toContain('data-fixture-footer');
    expect(html).toContain('data-final-chunk');
    expect(response.statusCode).toBe(200);
  });

  it('aborts a timed-out render and returns a shell error before flush', async () => {
    const response = await request('/timeout');

    expect(fixture.abortCount).toBe(1);
    expect(response.statusCode).toBe(500);
    expect(response.body.toString()).toContain('data-shell-error');
    expect(response.body.toString()).toContain('render timed out');
  });

  it('returns 500 when the shell fails before the first flush', async () => {
    const response = await request('/shell-error');

    expect(response.statusCode).toBe(500);
    expect(response.body.toString()).toContain('<p data-shell-error>shell failed</p>');
  });

  it('keeps the committed status and completes after a recoverable render error', async () => {
    const response = await request('/recoverable');
    const html = response.body.toString();

    expect(response.statusCode).toBe(200);
    expect(fixture.recoverableErrorCount).toBe(1);
    expect(html).toContain('data-shell');
    expect(html).toContain('data-react-recovery');
    expect(html).toContain('data-fixture-footer');
    expect(html).toContain('data-final-chunk');
  });

  it('aborts the stream and socket on a fatal transport error', async () => {
    const result = await new Promise<'aborted' | 'completed'>((resolve, reject) => {
      const req = http.request(
        {
          agent: false,
          host: '127.0.0.1',
          path: '/fatal',
          port,
        },
        (res) => {
          res.resume();
          res.on('aborted', () => resolve('aborted'));
          res.on('end', () => resolve('completed'));
          res.on('error', () => resolve('aborted'));
        },
      );

      req.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') {
          resolve('aborted');

          return;
        }

        reject(error);
      });
      req.end();
    });

    expect(fixture.fatalSocketClosed).toBe(true);
    expect(result).toBe('aborted');
  });
});
