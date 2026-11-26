// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { InlineConfig, Logger } from 'vite';
import { createLogger } from 'vite';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDevServer } from '@node/dev';
import type { ICreateDevServerOptions, IDevServer } from '@node/dev';
import ServerConfig from '@services/server-config';
import ViteSsrBoostPlugin from '../../src/plugin';

interface IProjectOptions {
  base?: string;
  html?: string;
}

interface IWireResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const SOURCE = path.resolve('src');
const ALIAS_DIRS = [
  'adapters',
  'browser',
  'cli',
  'components',
  'constants',
  'context',
  'core',
  'edge',
  'helpers',
  'interfaces',
  'node',
  'plugins',
  'services',
];
const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Dev</title></head>
  <body>
    <div id="root"><!--ssr-outlet--></div>
    <script type="module" src="/client.ts" async></script>
  </body>
</html>
`;

let root: string;
let started: IDevServer[];
let logger: { error: Mock<(message: string, options?: { error?: Error }) => void> };
let viteLogger: Logger;

/** Write one project file. */
const write = (file: string, content: string): void => {
  writeFileSync(path.join(root, file), content);
};

/** A plain project rendering through defineEntry, without JSX so no tsconfig is needed. */
const writeProject = ({ base = '/', html = INDEX_HTML }: IProjectOptions = {}): void => {
  const basename = base === '/' ? undefined : base.replace(/\/$/, '');

  mkdirSync(path.join(root, 'pages'), { recursive: true });
  write('index.html', html);
  write('client.ts', 'export {};\n');
  write('about.css', '.about-page { color: red; }\n');
  write(
    'pages/AboutPage.ts',
    "import { createElement } from 'react';\nimport '../about.css';\n\nexport function Component() {\n  return createElement('h1', { className: 'about-page' }, 'About page');\n}\n",
  );
  write(
    'pages/HomePage.ts',
    "import { createElement } from 'react';\n\nexport function Component() {\n  return createElement('p', null, 'Home v1');\n}\n",
  );
  write(
    'routes.ts',
    "export default [\n  { path: '/', lazy: () => import('./pages/HomePage') },\n  { path: '/about', lazy: () => import('./pages/AboutPage') },\n];\n",
  );
  write(
    'server.ts',
    `import { createElement } from 'react';
import defineEntry from '@lomray/vite-ssr-boost/core/entry';
import routes from './routes';

const App = ({ children }) => createElement('main', null, children);

export default defineEntry(App, routes, {
  routerOptions: { basename: ${JSON.stringify(basename)} },
  onRequest: ({ request }) =>
    new URL(request.url).pathname.endsWith('/bypass') ? new Response('bypassed') : undefined,
});
`,
  );
};

/** Inline Vite config resolving the package and its internal aliases from the source tree. */
const viteConfig = (overrides: InlineConfig = {}): InlineConfig => ({
  configFile: false,
  root,
  logLevel: 'silent',
  customLogger: viteLogger,
  plugins: [ViteSsrBoostPlugin({ tsconfigAliases: false })],
  resolve: {
    alias: [
      { find: /^@lomray\/vite-ssr-boost\//, replacement: `${SOURCE}/` },
      ...ALIAS_DIRS.map((dir) => ({
        find: new RegExp(`^@${dir}/`),
        replacement: `${SOURCE}/${dir}/`,
      })),
    ],
  },
  ...overrides,
});

/** Start a dev server on a random port and remember it for cleanup. */
const start = async (
  options: ICreateDevServerOptions = {},
): Promise<{ app: IDevServer; url: string; port: number }> => {
  const app = await createDevServer({ logger, vite: viteConfig(), ...options });

  started.push(app);

  const { port } = (await app.listen(0, '127.0.0.1')) as AddressInfo;
  const protocol = app.server instanceof https.Server ? 'https' : 'http';

  return { app, port, url: `${protocol}://127.0.0.1:${port}` };
};

/** Send one request and collect the whole body. */
const request = (url: string): Promise<IWireResponse> =>
  new Promise((resolve, reject) => {
    const transport = url.startsWith('https') ? https : http;
    const req = transport.request(
      url,
      { rejectUnauthorized: false, headers: { Accept: 'text/html' } },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );

    req.on('error', reject);
    req.end();
  });

/** Repeat a request until its body satisfies the check, for edits the watcher picks up. */
const requestUntil = async (
  url: string,
  check: (body: string) => boolean,
  attempts = 50,
): Promise<IWireResponse> => {
  const response = await request(url);

  if (check(response.body) || attempts <= 1) {
    return response;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 100);
  });

  return requestUntil(url, check, attempts - 1);
};

/** Open Vite's HMR websocket on the parent port and wait for its first text frame. */
const connectHmr = (app: IDevServer, url: string): Promise<{ socket: Duplex; message: string }> =>
  new Promise((resolve, reject) => {
    const token = (app.vite.config as { webSocketToken?: string }).webSocketToken ?? '';
    const transport = url.startsWith('https') ? https : http;
    const req = transport.request(`${url}${app.vite.config.base}?token=${token}`, {
      rejectUnauthorized: false,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': Buffer.alloc(16, 1).toString('base64'),
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Protocol': 'vite-hmr',
      },
    });

    req.on('upgrade', (_res, socket, head: Buffer) => {
      let received = head;

      /**
       * Server frames are unmasked; the connected payload is short enough for a one-byte length.
       * The frame may arrive with the handshake (in head) or in later chunks.
       */
      const parse = (): boolean => {
        if (received.length < 2 || received.length < 2 + (received[1] & 0x7f)) {
          return false;
        }

        resolve({
          socket,
          message: received.subarray(2, 2 + (received[1] & 0x7f)).toString('utf8'),
        });

        return true;
      };

      if (parse()) {
        return;
      }

      /**
       * Collect chunks until one whole frame is buffered.
       */
      const onData = (chunk: Buffer): void => {
        received = Buffer.concat([received, chunk]);

        if (parse()) {
          socket.off('data', onData);
        }
      };

      socket.on('data', onData);
    });
    req.on('response', (res) => reject(new Error(`No upgrade: ${res.statusCode}`)));
    req.on('error', reject);
    req.end();
  });

beforeEach(() => {
  global.viteBoostAction = 'dev';
  root = mkdtempSync(path.resolve('.ssr-boost-dev-test-'));
  started = [];
  logger = { error: vi.fn() };
  viteLogger = createLogger('silent');
  vi.spyOn(viteLogger, 'warn');
  vi.spyOn(viteLogger, 'warnOnce');
});

afterEach(async () => {
  await Promise.all(
    started.map((app) => {
      app.server.closeAllConnections();

      return app.close();
    }),
  );
  rmSync(root, { recursive: true, force: true });
});

describe('createDevServer', { timeout: 30000 }, () => {
  it('renders through Vite and keeps the client entry synchronous', async () => {
    writeProject();

    const { url } = await start();
    const response = await request(`${url}/`);

    expect(response.status).toBe(200);
    expect(response.body).toContain('Home v1');
    expect(response.body).toContain('/@vite/client');
    expect(response.body).toMatch(/<script type="module" src="\/client.ts"><\/script>/);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reloads server code and keeps route styles across edits', async () => {
    writeProject();

    const { url } = await start();
    const first = await request(`${url}/about`);

    expect(first.body).toContain('About page');
    expect(first.body).toMatch(/<style data-vite-dev-id="[^"]*about\.css">[^<]*red/);

    write('about.css', '.about-page { color: blue; }\n');
    write(
      'pages/HomePage.ts',
      "import { createElement } from 'react';\n\nexport function Component() {\n  return createElement('p', null, 'Home v2');\n}\n",
    );

    const edited = await requestUntil(`${url}/about`, (body) => body.includes('blue'));
    const home = await requestUntil(`${url}/`, (body) => body.includes('Home v2'));

    expect(edited.body).toMatch(/<style data-vite-dev-id="[^"]*about\.css">[^<]*blue/);
    expect(edited.body).not.toContain('red');
    expect(home.body).toContain('Home v2');
  });

  it('reads the document only when the entry renders', async () => {
    writeProject({ html: '<!doctype html><html><head></head><body></body></html>' });

    const { url } = await start();
    const bypass = await request(`${url}/bypass`);
    const rendered = await request(`${url}/`);

    expect(bypass).toMatchObject({ status: 200, body: 'bypassed' });
    expect(rendered.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });

  it('serves HMR on the parent port without deprecation warnings, also after a restart', async () => {
    writeProject();

    const { app, url } = await start();
    const first = await connectHmr(app, url);

    expect(JSON.parse(first.message)).toMatchObject({ type: 'connected' });
    first.socket.destroy();

    await app.vite.restart();

    const second = await connectHmr(app, url);

    expect(JSON.parse(second.message)).toMatchObject({ type: 'connected' });
    expect((await request(`${url}/`)).body).toContain('Home v1');
    second.socket.destroy();

    const warnings = [
      ...vi.mocked(viteLogger.warn).mock.calls,
      ...vi.mocked(viteLogger.warnOnce).mock.calls,
    ].map(([message]) => message);

    expect(warnings.filter((message) => /hmr/i.test(message))).toEqual([]);
  });

  it('closes with a connected HMR client and closes Vite', async () => {
    writeProject();

    const onDrain = vi.fn();
    const { app, url } = await start({ onDrain });
    const { socket } = await connectHmr(app, url);
    const closed = new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
    });
    const viteClose = vi.spyOn(app.vite, 'close');

    await app.close();
    await closed;

    expect(viteClose).toHaveBeenCalledTimes(1);
    expect(onDrain).toHaveBeenCalledTimes(1);
    expect(app.server.listening).toBe(false);
    started = [];
  });

  it('serves HTTPS from the Vite config, HMR included', async () => {
    writeProject();

    const key = path.join(root, 'key.pem');
    const cert = path.join(root, 'cert.pem');

    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-subj',
        '/CN=dev',
        '-days',
        '1',
        '-keyout',
        key,
        '-out',
        cert,
      ],
      { stdio: 'ignore' },
    );

    const { app, url } = await start({ vite: viteConfig({ server: { https: { key, cert } } }) });
    const response = await request(`${url}/`);
    const { socket, message } = await connectHmr(app, url);

    expect(app.server).toBeInstanceOf(https.Server);
    expect(response.body).toContain('Home v1');
    expect(JSON.parse(message)).toMatchObject({ type: 'connected' });
    socket.destroy();
  });

  it('renders under a base path from the URL the browser sent', async () => {
    writeProject({ base: '/app/' });

    const { url } = await start({ vite: viteConfig({ base: '/app/' }) });
    const response = await request(`${url}/app/about`);

    expect(response.status).toBe(200);
    expect(response.body).toContain('About page');
    expect(response.body).toMatch(/<script type="module" src="\/app\/client.ts"><\/script>/);
  });

  it('serves the transformed document on every route for client-only entrypoints', async () => {
    writeProject();

    const { url } = await start({
      config: ServerConfig.init({ isOnlyClient: true, mode: 'development' }),
    });
    const response = await request(`${url}/any/route`);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toContain('/@vite/client');
    expect(response.body).not.toContain('Home v1');
  });

  it('explains a missing plugin and leaves no Vite server running', async () => {
    writeProject();

    await expect(createDevServer({ logger, vite: viteConfig({ plugins: [] }) })).rejects.toThrow(
      'Failed to get to plugin config',
    );
  });
});
