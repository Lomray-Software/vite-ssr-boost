// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Miniflare edge app', () => {
  let miniflare: Miniflare;
  let caching: Miniflare;

  beforeAll(async () => {
    const useBuildOutput = process.env.SSR_BOOST_PACKED_EDGE === '1';
    let buildOutputImports = 0;
    const bundle = await build({
      bundle: true,
      conditions: ['workerd', 'worker', 'browser'],
      define: { 'process.env.NODE_ENV': '"production"' },
      entryPoints: [fileURLToPath(new URL('../../__fixtures__/edge-app.tsx', import.meta.url))],
      format: 'esm',
      outfile: 'worker.mjs',
      platform: 'browser',
      plugins: useBuildOutput
        ? [
            {
              name: 'vite-ssr-boost-build-output',
              setup(buildContext) {
                buildContext.onResolve(
                  {
                    filter: /^\.\.\/src\/(?:adapters\/edge|core\/handler|edge\/render-to-stream)$/,
                  },
                  ({ path }) => {
                    buildOutputImports += 1;

                    return {
                      path: fileURLToPath(
                        new URL(`../../lib/${path.slice('../src/'.length)}.js`, import.meta.url),
                      ),
                    };
                  },
                );
              },
            },
          ]
        : [],
      supported: { 'dynamic-import': false },
      target: 'es2022',
      tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)),
      write: false,
    });

    if (useBuildOutput && buildOutputImports !== 3) {
      throw new Error(`Expected 3 build-output imports, resolved ${buildOutputImports}.`);
    }

    miniflare = new Miniflare({
      compatibilityDate: '2025-01-01',
      modules: [
        {
          contents: bundle.outputFiles[0].text,
          path: 'worker.mjs',
          type: 'ESModule',
        },
      ],
    });

    const cachingBundle = await build({
      bundle: true,
      conditions: ['workerd', 'worker', 'browser'],
      define: { 'process.env.NODE_ENV': '"production"' },
      entryPoints: [
        fileURLToPath(new URL('../../__fixtures__/caching/worker.ts', import.meta.url)),
      ],
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      write: false,
      plugins: [
        {
          name: 'caching-recipe-package',
          setup(builder) {
            builder.onResolve({ filter: /^@lomray\/vite-ssr-boost\// }, ({ path }) => ({
              path: fileURLToPath(
                new URL(
                  `../../${useBuildOutput ? 'lib' : 'src'}/${path.slice('@lomray/vite-ssr-boost/'.length)}.${useBuildOutput ? 'js' : 'ts'}`,
                  import.meta.url,
                ),
              ),
            }));
          },
        },
      ],
    });
    caching = new Miniflare({
      compatibilityDate: '2025-01-01',
      modules: [
        {
          contents: cachingBundle.outputFiles[0].text,
          path: 'caching-worker.mjs',
          type: 'ESModule',
        },
      ],
    });
  }, 30_000);

  afterAll(async () => {
    await Promise.all([miniflare?.dispose(), caching?.dispose()]);
  });

  it('runs the complete Worker Cache API recipe with guest hits and credential bypass', async () => {
    const url = 'https://edge.example/guest';
    const miss = await caching.dispatchFetch(url);
    expect(miss.headers.get('Cache-Control')).toBe('public, max-age=30, stale-while-revalidate=60');
    expect(await miss.text()).toContain('Guest page');
    const hit = await caching.dispatchFetch(url);
    expect(hit.headers.has('Age')).toBe(true);
    expect(await hit.text()).toContain('Guest page');
    for (const headers of [{ Cookie: 'session=' }, { Authorization: 'Bearer secret' }]) {
      const account = await caching.dispatchFetch(url, { headers });
      expect(account.headers.get('Cache-Control')).toBe('private, no-store');
      expect(account.headers.has('Age')).toBe(false);
      expect(await account.text()).toContain('Account page');
    }
    const guest = await caching.dispatchFetch(url);
    expect(guest.headers.has('Age')).toBe(true);
    expect(await guest.text()).toContain('Guest page');
  });

  it('boots and streams a real SSR app inside workerd', async () => {
    const response = await miniflare.dispatchFetch(
      'https://edge.example/render?inspect-compression',
      {
        headers: { 'Accept-Encoding': 'gzip' },
      },
    );
    const inspected = (await response.json()) as {
      cookies: string[];
      encoding: string;
      html: string;
      vary: string;
    };

    expect(response.status).toBe(200);
    expect(inspected.encoding).toBe('gzip');
    expect(inspected.vary).toBe('Accept-Encoding');
    expect(inspected.cookies).toEqual([
      'one=1; Path=/',
      'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
    ]);
    expect(inspected.html).toContain('<main>Edge runtime</main>');
    expect(inspected.html).toContain('</div></body></html>');
  });

  it.each([
    ['/render', 202],
    ['/shell-error', 500],
  ] as const)(
    'returns a bodyless HEAD response for %s inside workerd',
    async (pathname, status) => {
      const response = await miniflare.dispatchFetch(`https://edge.example${pathname}`, {
        method: 'HEAD',
      });

      expect(response.status).toBe(status);
      expect(await response.text()).toBe('');
      expect(response.headers.getSetCookie()).toHaveLength(2);
    },
  );
});
