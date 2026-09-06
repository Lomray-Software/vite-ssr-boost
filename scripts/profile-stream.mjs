import http from 'node:http';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createGunzip } from 'node:zlib';
import express from 'express';
import compression from 'compression';
import React, { Suspense } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { Await, createStaticHandler, useLoaderData } from 'react-router';
import entry from '../lib/adapters/express/entry.js';
import createHandler from '../lib/core/handler.js';
import adapterExpress from '../lib/adapters/express.js';
import nodeRenderer from '../lib/node/render-to-stream.js';
import edgeRenderer from '../lib/edge/render-to-stream.js';

const { createElement: element } = React;
const samples = Number(process.env.SAMPLES ?? 30);
const concurrency = Number(process.env.CONCURRENCY ?? 10);
const targetUrl = process.env.PROFILE_URL;
const warmup = Number(process.env.WARMUP ?? concurrency * 2);
const warmupConcurrency = Number(process.env.WARMUP_CONCURRENCY ?? concurrency);
const runtimes = (process.env.RUNTIMES ?? 'raw,managed,node,edge').split(',');
const encodings = (process.env.ENCODINGS ?? 'identity,gzip').split(',');
const html = { header: '<!doctype html><html><head><title>Profile</title></head><body><div id="root">', footer: '</div></body></html>' };
const records = new Map();
const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

assert.ok(Number.isInteger(samples) && samples > 0, 'SAMPLES must be a positive integer.');
assert.ok(Number.isInteger(concurrency) && concurrency > 0, 'CONCURRENCY must be a positive integer.');
assert.ok(Number.isInteger(warmup) && warmup >= 0, 'WARMUP must be a nonnegative integer.');
assert.ok(Number.isInteger(warmupConcurrency) && warmupConcurrency > 0, 'WARMUP_CONCURRENCY must be a positive integer.');
assert.ok(runtimes.every((runtime) => ['raw', 'managed', 'node', 'edge'].includes(runtime)), 'Unknown RUNTIMES entry.');
assert.ok(encodings.every((encoding) => ['identity', 'gzip'].includes(encoding)), 'Unknown ENCODINGS entry.');

/** Keep the shell independent of the deliberately slow route data. */
const load = () => ({ slow: new Promise((resolve) => setTimeout(() => resolve('ready'), 800)) });

/** Render the same suspended content in every runtime. */
const Content = ({ slow }) => element(Suspense, { fallback: element('p', null, 'loading') }, element(Await, { resolve: slow }, (value) => element('p', null, value)));

/** Read router data without adding application work. */
const Page = () => element(Content, useLoaderData());

/** Keep application markup identical across transports. */
const App = ({ children }) => element('main', null, children);
const routes = [
  { path: '/:runtime/home', Component: () => element('p', null, 'home') },
  { path: '/:runtime/deferred', loader: load, Component: Page },
];
const prepared = entry(App, routes);
const config = { isProd: process.env.NODE_ENV === 'production', getLogger: () => ({ error: console.error, info: () => undefined }), getParams: () => ({ root: process.cwd() }), getVite: () => undefined, isModulePreload: false };

/** Keep the request timeline available after response completion. */
const onShellReady = ({ context }) => {
  records.get(context.request.headers.get('x-profile-id')).timeline = context.timeline;
};

/** Match the buffered home and streamed deferred acceptance cases. */
const onRouterReady = ({ context }) => ({ isStream: context.request.url.endsWith('/deferred') });
const options = { diagnostics: false, getHtml: () => html, onShellReady, onRouterReady };
const nodeHandler = createHandler({ handler: createStaticHandler(routes), createApp: (children) => element(App, null, children), renderToStream: nodeRenderer }, options);
const edgeHandler = createHandler({ handler: createStaticHandler(routes), createApp: (children) => element(App, null, children), renderToStream: edgeRenderer }, options);
const app = express();

/** Mark transport entry and the first actual socket write independently of headers. */
app.use((request, response, next) => {
  const record = { started: performance.now() };
  records.set(request.headers['x-profile-id'], record);
  const { socket } = response;
  const socketWrite = socket.write;
  socket.write = function (...args) {
    record.socketWrite ??= performance.now() - record.started;

    return socketWrite.apply(this, args);
  };
  response.once('finish', () => { socket.write = socketWrite; });
  next();
});
app.use(compression());

/** Measure when the adapter hands HTML to compression or the native response. */
app.use((request, response, next) => {
  const record = records.get(request.headers['x-profile-id']);
  const write = response.write;
  response.write = function (...args) {
    record.adapterWrite ??= performance.now() - record.started;

    return write.apply(this, args);
  };
  next();
});
app.use('/node', adapterExpress(nodeHandler));
app.use('/edge', adapterExpress(edgeHandler));

/** Compare the managed entry with raw React piping on the same Express server. */
app.use((request, response) => {
  if (request.path.startsWith('/managed/')) {
    void prepared.render(config, { req: request, res: response, html, appProps: {} }, { onShellReady, onRouterReady });

    return;
  }
  const record = records.get(request.headers['x-profile-id']);
  const content = request.path.endsWith('/deferred') ? element(Content, load()) : element('p', null, 'home');
  const rendered = renderToPipeableStream(element(App, null, content), {
    /** Start raw piping at the earliest React shell callback. */
    onShellReady() {
      record.shellReady = performance.now() - record.started;
      response.setHeader('Content-Type', 'text/html');
      response.write(html.header);
      response.flush?.();
      rendered.pipe(response);
    },
    onError: console.error,
  });
});
const server = targetUrl ? undefined : app.listen(0, '127.0.0.1');
if (server) await once(server, 'listening');
const origin = targetUrl ?? `http://127.0.0.1:${server.address().port}`;
let requestId = 0;

/** Measure first decoded HTML as well as the benchmark's header timestamp. */
const request = (pathname, encoding, agent) => new Promise((resolve, reject) => {
  const id = String(requestId++);
  const started = performance.now();
  const pending = http.get(origin + pathname, { agent, headers: { 'user-agent': userAgent, 'accept-encoding': encoding, 'x-profile-id': id } }, (response) => {
    const headers = performance.now() - started;
    const decoded = response.headers['content-encoding'] === 'gzip' ? response.pipe(createGunzip()) : response;
    let firstHtml;
    decoded.on('data', () => { firstHtml ??= performance.now() - started; });
    decoded.on('error', reject);
    response.on('error', reject);
    decoded.on('end', () => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${pathname}`));

        return;
      }

      const record = records.get(id) ?? {};
      const stages = Object.fromEntries((record.timeline?.events ?? []).map(({ stage, at }) => [stage, at + record.timeline.started - record.started]));
      records.delete(id);
      resolve({ headers, firstHtml, 'router.query': stages['router.query'], prepare: stages.prepare, 'shell.ready': stages['shell.ready'] ?? record.shellReady, 'adapter.write': record.adapterWrite, 'socket.write': record.socketWrite, 'shell-to-write': record.adapterWrite - (stages['shell.ready'] ?? record.shellReady) });
    });
  }).on('error', reject);
  pending.setTimeout(10_000, () => pending.destroy(new Error(`Timed out: ${pathname}`)));
});

/** Use fixed batches and keep-alive sockets like the public benchmark. */
const batch = async (pathname, encoding, count, connections = concurrency) => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: connections });
  const results = [];
  try {
    for (let index = 0; index < count; index += connections) {
      results.push(...await Promise.all(Array.from({ length: Math.min(connections, count - index) }, () => request(pathname, encoding, agent))));
    }

    return results;
  } finally {
    agent.destroy();
  }
};

/** Summarize stage completion with warm p50 measurements. */
const median = (values) => values.sort((left, right) => left - right)[Math.floor(values.length / 2)];

/** Mark sampling windows and read CPU usage from the opt-in production preload. */
const control = async (command) => {
  const response = await fetch(origin, { headers: { 'x-ssr-profile': command } });
  assert.equal(response.headers.get('content-type'), 'application/json', 'Start the target with --import scripts/profile-server.mjs.');

  return response.json();
};

try {
  for (const encoding of encodings) {
    for (const runtime of targetUrl ? ['production'] : runtimes) {
      for (const route of targetUrl ? (process.env.ROUTES ?? '/,/items,/items/1').split(',') : ['home', 'deferred']) {
        const pathname = targetUrl ? route : `/${runtime}/${route}`;
        await batch(pathname, encoding, warmup, warmupConcurrency);
        if (targetUrl) await control('start');
        const results = await batch(pathname, encoding, samples);
        const usage = targetUrl ? await control('end') : undefined;
        const medians = Object.fromEntries(Object.keys(results[0]).filter((key) => results.every((result) => Number.isFinite(result[key]))).map((key) => [key, Number(median(results.map((result) => result[key])).toFixed(3))]));
        console.info(JSON.stringify({ pathname, encoding, samples, concurrency, warmup, warmupConcurrency, ...medians, ...(usage ? { ...usage, cpuUsPerRequest: usage.cpuUs / usage.requests, mainThreadCpuUsPerRequest: usage.mainThreadCpuUs === undefined ? undefined : usage.mainThreadCpuUs / usage.requests } : {}) }));
      }
    }
  }
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
