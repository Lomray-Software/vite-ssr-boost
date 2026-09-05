// @vitest-environment node
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ISsrRequestContext } from '@core/render';
import { createRouteAssetPreparer, loadHtmlShell } from '@node/production';
import ServerConfig from '@services/server-config';
import SsrManifest from '@services/ssr-manifest';

const fixtureDir = fileURLToPath(new URL('../../__mocks__/production-build/', import.meta.url));
const originalCwd = process.cwd();
let directory: string;
let buildDir: string;
let indexFile: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ssr-production-'));
  buildDir = join(directory, 'build');
  indexFile = join(buildDir, 'client/index.html');
  await cp(fixtureDir, buildDir, { recursive: true });
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(directory, { recursive: true, force: true });
  (SsrManifest as unknown as { instance: unknown }).instance = null;
});

describe('loadHtmlShell', () => {
  it('reads once and returns fresh shells after the file is removed', async () => {
    const getHtml = await loadHtmlShell({ indexFile });
    const first = getHtml();
    const second = getHtml();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.header).toContain('<div id="root">');
    expect(first.footer).toBe('</div></body></html>\n');
    first.header = 'changed by one request';
    first.footer = 'changed footer';
    await rm(indexFile);
    expect(getHtml()).toEqual(second);
  });

  it.each(['no outlet', '<!--ssr-outlet--><!--ssr-outlet-->'])(
    'rejects invalid outlet counts in %s and names the file',
    async (html) => {
      await writeFile(indexFile, html);
      await expect(loadHtmlShell({ indexFile })).rejects.toThrow(indexFile);
      await expect(loadHtmlShell({ indexFile })).rejects.toThrow('expected exactly one');
    },
  );

  it('supports a custom outlet and empty shell halves', async () => {
    await writeFile(indexFile, '{{app}}');
    const getHtml = await loadHtmlShell({ indexFile, outlet: '{{app}}' });
    expect(getHtml()).toEqual({ header: '', footer: '' });
    await writeFile(indexFile, '{{app}}{{app}}');
    await expect(loadHtmlShell({ indexFile, outlet: '{{app}}' })).rejects.toThrow(indexFile);
  });

  it('rejects an empty outlet', async () => {
    await writeFile(indexFile, 'ab');
    await expect(loadHtmlShell({ indexFile, outlet: '' })).rejects.toThrow(indexFile);
  });

  it('reports an unreadable file', async () => {
    await rm(indexFile);
    await expect(loadHtmlShell({ indexFile })).rejects.toThrow(indexFile);
  });
});

describe('createRouteAssetPreparer', () => {
  const createContext = async (
    pathname = '/about',
  ): Promise<ISsrRequestContext<{ app: string }>> => {
    const router = createStaticHandler([
      { path: '/', Component: () => null },
      { path: '/about', lazy: async () => ({ Component: () => null }) },
    ]);
    const request = new Request(`http://localhost${pathname}`);
    const routerContext = await router.query(request);
    if (routerContext instanceof Response) {
      throw new Error('Expected a matched route');
    }
    return {
      appProps: { app: 'fixture' },
      html: (await loadHtmlShell({ indexFile }))(),
      request,
      response: { headers: new Headers() },
      routerContext,
    };
  };

  it('injects lazy route styles and forwards Early Hints before resolving', async () => {
    const prepare = createRouteAssetPreparer<{ app: string }>({ buildDir });
    const context = await createContext();
    const footer = context.html.footer;
    let release: () => void = () => undefined;
    const onEarlyHints = vi.fn<(headers: Headers) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const prepared = prepare({ context, executionContext: { onEarlyHints } });
    expect(context.html.header).toContain(
      '<link rel="stylesheet" href="/assets/about.css"></head>',
    );
    expect(context.html.header).not.toContain('modulepreload');
    expect(context.html.header).not.toContain('/assets/home.js');
    expect(context.html.footer).toBe(footer);
    expect(onEarlyHints).toHaveBeenCalledOnce();
    const [hints] = onEarlyHints.mock.calls[0];
    expect(hints.get('Link')).toBe(
      '</assets/about.css>; rel=preload; as=style, </assets/about.js>; rel=preload; as=script',
    );
    let completed = false;
    void Promise.resolve(prepared).then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    release();
    await prepared;
    expect(completed).toBe(true);
  });

  it('enables module preload without requiring an Early Hints callback', async () => {
    const context = await createContext();
    await createRouteAssetPreparer({ buildDir, modulePreload: true })({ context });
    expect(context.html.header).toContain(
      '<link rel="modulepreload" as="script" crossorigin href="/assets/about.js">',
    );
  });

  it('does not forward empty hints or inject unmatched route assets', async () => {
    const context = await createContext();
    context.routerContext = undefined;
    const shell = { ...context.html };
    const onEarlyHints = vi.fn();
    await createRouteAssetPreparer({ buildDir })({ context, executionContext: { onEarlyHints } });
    expect(context.html).toEqual(shell);
    expect(onEarlyHints).not.toHaveBeenCalled();
  });

  it('leaves the shell unchanged when the manifest is missing', async () => {
    await rm(join(buildDir, 'server/assets-manifest.json'));
    const context = await createContext();
    const shell = { ...context.html };
    const onEarlyHints = vi.fn();
    await createRouteAssetPreparer({ buildDir })({ context, executionContext: { onEarlyHints } });
    expect(context.html).toEqual(shell);
    expect(onEarlyHints).not.toHaveBeenCalled();
  });

  it('propagates invalid manifest JSON', async () => {
    await writeFile(join(buildDir, 'server/assets-manifest.json'), '{invalid');
    const context = await createContext();
    await expect(createRouteAssetPreparer({ buildDir })({ context })).rejects.toThrow(SyntaxError);
  });

  it('keeps requests and build caches independent of the managed singleton', async () => {
    const otherBuild = join(directory, 'other-build');
    await cp(buildDir, otherBuild, { recursive: true });
    const manifestFile = join(otherBuild, 'server/assets-manifest.json');
    await writeFile(
      manifestFile,
      (await readFile(manifestFile, 'utf8')).replaceAll('/assets/', '/other/'),
    );
    const managed = SsrManifest.get(ServerConfig.init({ isProd: true }, { root: buildDir }));
    managed.injectAssets(await createContext());
    const first = createRouteAssetPreparer({ buildDir });
    const second = createRouteAssetPreparer({ buildDir: otherBuild });
    const firstContext = await createContext();
    const secondContext = await createContext();
    await Promise.all([first({ context: firstContext }), second({ context: secondContext })]);
    expect(firstContext.html.header).toContain('/assets/about.css');
    expect(secondContext.html.header).toContain('/other/about.css');
    expect(secondContext.html.header).not.toContain('/assets/about.css');
    await rm(manifestFile);
    const cachedContext = await createContext();
    await second({ context: cachedContext });
    expect(cachedContext.html).toEqual(secondContext.html);
    const home = await createContext('/');
    await first({ context: home });
    expect(home.html.header).not.toContain('/assets/about.css');
    const managedContext = await createContext();
    managed.injectAssets(managedContext);
    expect(managedContext.html).toEqual(firstContext.html);
  });

  it('uses explicit paths from another working directory and pins relative build paths', async () => {
    process.chdir(directory);
    const absolute = createRouteAssetPreparer({ buildDir });
    const relative = createRouteAssetPreparer({ buildDir: 'build' });
    process.chdir(tmpdir());
    expect(process.cwd()).not.toBe(originalCwd);
    const context = await createContext();
    const otherContext = await createContext();
    await absolute({ context });
    await relative({ context: otherContext });
    expect(context.html.header).toContain('/assets/about.css');
    expect(otherContext.html).toEqual(context.html);
  });
});
