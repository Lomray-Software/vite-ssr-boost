import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import express from 'express';
import adapterNode from '../lib/adapters/node.js';

const directory = await mkdtemp(join(tmpdir(), 'ssr-boost-browser-'));
const root = resolve('__fixtures__/browser-template');
const config = {
  configFile: false,
  root,
  logLevel: 'warn',
  resolve: {
    alias: { '@lomray/vite-ssr-boost': resolve('lib') },
    dedupe: ['react', 'react-dom', 'react-router'],
  },
};
await build({ ...config, build: { outDir: join(directory, 'client'), emptyOutDir: true } });
// Bundle the server so its temporary output doesn't need its own node_modules tree.
await build({
  ...config,
  ssr: { noExternal: true },
  build: { ssr: join(root, 'server.jsx'), outDir: join(directory, 'server'), emptyOutDir: true },
});
const document = await readFile(join(directory, 'client/index.html'), 'utf8');
const [header, footer] = document.split('<!--ssr-outlet-->');
const { handler } = await import(pathToFileURL(join(directory, 'server/server.js')).href);
const app = express();
app.get('/api/slow', (_, response) => response.json({ users: 3 }));
app.use(
  '/assets',
  express.static(join(directory, 'client/assets'), { maxAge: '1h', immutable: true }),
);
app.use(adapterNode(handler({ header, footer })));
const upstream = http.createServer(app).listen(0, '127.0.0.1');
await once(upstream, 'listening');
const port = upstream.address().port;
const proxy = http
  .createServer((request, response) => {
    const forward = () => {
      if (response.destroyed) return;
      // Preserve Host: SSR loader API requests must also travel through this proxy.
      const pending = http.request(
        {
          host: '127.0.0.1',
          port,
          path: request.url,
          method: request.method,
          headers: request.headers,
        },
        (result) => {
          response.writeHead(result.statusCode, result.headers);
          result.pipe(response);
        },
      );
      pending.on('error', () => {
        if (!response.destroyed) response.writeHead(502).end();
      });
      response.on('close', () => pending.destroy());
      request.pipe(pending);
    };
    if (request.url.startsWith('/api/slow')) setTimeout(forward, 2000);
    else forward();
  })
  .listen(Number(process.env.BROWSER_TEST_PORT || 4179), '127.0.0.1');
await once(proxy, 'listening');
console.info(`Browser fixture ready: http://127.0.0.1:${proxy.address().port}`);
const stop = async () => {
  proxy.closeAllConnections();
  upstream.closeAllConnections();
  await Promise.all([
    new Promise((resolve) => proxy.close(resolve)),
    new Promise((resolve) => upstream.close(resolve)),
  ]);
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
