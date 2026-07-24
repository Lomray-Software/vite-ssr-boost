// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Miniflare edge app', () => {
  let miniflare: Miniflare;

  beforeAll(async () => {
    const useBuildOutput = process.env.SSR_BOOST_PACKED_EDGE === '1';
    let buildOutputImports = 0;
    const bundle = await build({
      bundle: true,
      conditions: ['worker', 'browser'],
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
  }, 30_000);

  afterAll(async () => {
    await miniflare.dispose();
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
});
