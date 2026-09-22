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
    await mkdir(path.join(root, '.well-known'));
    await writeFile(path.join(root, '.well-known', 'assetlinks.json'), '[]');
    await writeFile(path.join(root, '.well-known', 'apple-app-site-association.json'), '{}');
    await writeFile(path.join(root, '.env'), 'secret');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  /** Start a mounted static handler with an observable SSR fallback. */
  const start = async (options = {}, isSPA = false): Promise<string> => {
    const app = express();
    app.use('/base', staticFiles(root, { index: false, ...options }, isSPA));
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

  it.each([
    ['SSR', false],
    ['SPA', true],
  ])(
    'serves /.well-known/ and keeps other dotfiles hidden by default in %s mode',
    async (_, isSPA) => {
      const origin = await start({}, isSPA);
      const stat = vi.spyOn(fs, 'stat');

      expect(await (await fetch(`${origin}/.well-known/assetlinks.json`)).text()).toBe('[]');
      expect(await (await fetch(`${origin}/%2Ewell-known/assetlinks.json`)).text()).toBe('[]');
      expect(await (await fetch(`${origin}/.env`)).text()).toBe('SSR');
      expect(await (await fetch(`${origin}/.well-known/../.env`)).text()).toBe('SSR');
      expect(await (await fetch(`${origin}/.well-known/%2E%2E/.env`)).text()).toBe('SSR');
      expect(await (await fetch(`${origin}/.well-known/missing`)).text()).toBe('SSR');
      expect(stat).not.toHaveBeenCalledWith(expect.stringContaining('.env'), expect.anything());
    },
  );

  it('resolves extensionless /.well-known/ requests to the .json file', async () => {
    const origin = await start();
    const association = await fetch(`${origin}/.well-known/apple-app-site-association`);
    expect(association.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await association.text()).toBe('{}');
    const explicit = await fetch(`${origin}/.well-known/apple-app-site-association.json`);
    expect(explicit.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await (await fetch(`${origin}/.well-known/assetlinks`)).text()).toBe('[]');
    expect(await (await fetch(`${origin}/.well-known/missing`)).text()).toBe('SSR');
    expect(await (await fetch(`${origin}/health`)).text()).toBe('extensionless');
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));

    const disabled = await start({ extensions: [] });
    expect(await (await fetch(`${disabled}/.well-known/apple-app-site-association`)).text()).toBe(
      'SSR',
    );
  });

  it('honours an explicit dotfiles option for /.well-known/ as well', async () => {
    const denied = await start({ dotfiles: 'deny', fallthrough: false });
    expect((await fetch(`${denied}/.well-known/assetlinks.json`)).status).toBe(403);
    expect((await fetch(`${denied}/.env`)).status).toBe(403);
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));

    const allowed = await start({ dotfiles: 'allow' });
    expect(await (await fetch(`${allowed}/.env`)).text()).toBe('secret');
  });

  it('preserves extension fallbacks and explicit static 404 handling', async () => {
    const origin = await start({ extensions: ['html'], fallthrough: false });
    expect(await (await fetch(`${origin}/about`)).text()).toBe('extension-fallback');
    expect((await fetch(`${origin}/missing`)).status).toBe(404);
  });
});
