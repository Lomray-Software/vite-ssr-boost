// @vitest-environment node
import fs from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import staticFiles from '@adapters/express/static-files';

describe('production static prefixes', () => {
  let root: string;
  let server: Server | undefined;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ssr-static-'));
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets', 'app.js'), 'built-script');
    await writeFile(path.join(root, 'robots.txt'), 'public-file');
    await writeFile(path.join(root, 'health'), 'extensionless');
    await writeFile(path.join(root, 'about.html'), 'extension-fallback');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  /** Start a mounted static handler with an observable SSR fallback. */
  const start = async (options = {}): Promise<string> => {
    const app = express();
    app.use('/base', staticFiles(root, { index: false, ...options }));
    app.use((_, response) => response.send('SSR'));
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();

    return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/base`;
  };

  it('does no filesystem stats for HTML routes, including query strings', async () => {
    const origin = await start();
    const stat = vi.spyOn(fs, 'stat');

    for (const pathname of ['/', '/items', '/items/1?sort=name']) {
      expect(await (await fetch(origin + pathname)).text()).toBe('SSR');
    }

    expect(stat).not.toHaveBeenCalled();
  });

  it('retains built assets, public files, encoded URLs, HEAD, ranges and validators', async () => {
    const origin = await start();
    const asset = await fetch(`${origin}/%61ssets/app.js?v=1`);
    expect(await asset.text()).toBe('built-script');
    expect(await (await fetch(`${origin}/robots.txt`)).text()).toBe('public-file');
    expect(await (await fetch(`${origin}/health`)).text()).toBe('extensionless');
    const head = await fetch(`${origin}/health`, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('13');
    expect(await head.text()).toBe('');
    const partial = await fetch(`${origin}/assets/app.js`, { headers: { Range: 'bytes=0-4' } });
    expect(partial.status).toBe(206);
    expect(await partial.text()).toBe('built');
    const cached = await fetch(`${origin}/assets/app.js`, {
      headers: { 'If-None-Match': asset.headers.get('etag')!, 'Cache-Control': 'max-age=0' },
    });
    expect(cached.status).toBe(304);
    const redirect = await fetch(`${origin}/assets`, { redirect: 'manual' });
    expect(redirect.status).toBe(301);
    expect(await (await fetch(`${origin}/assets/missing.js`)).text()).toBe('SSR');
  });

  it('preserves extension fallbacks and explicit static 404 handling', async () => {
    const origin = await start({ extensions: ['html'], fallthrough: false });
    expect(await (await fetch(`${origin}/about`)).text()).toBe('extension-fallback');
    expect((await fetch(`${origin}/missing`)).status).toBe(404);
  });
});
