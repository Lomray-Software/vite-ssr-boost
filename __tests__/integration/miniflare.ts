// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Miniflare edge app', () => {
  let miniflare: Miniflare;

  beforeAll(async () => {
    const bundle = await build({
      bundle: true,
      conditions: ['worker', 'browser'],
      define: { 'process.env.NODE_ENV': '"production"' },
      entryPoints: [fileURLToPath(new URL('../../__fixtures__/edge-app.tsx', import.meta.url))],
      format: 'esm',
      outfile: 'worker.mjs',
      platform: 'browser',
      supported: { 'dynamic-import': false },
      target: 'es2022',
      tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)),
      write: false,
    });

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
    const response = await miniflare.dispatchFetch('https://edge.example/render');
    const html = await response.text();

    expect(response.status).toBe(202);
    expect(response.headers.getSetCookie()).toEqual([
      'one=1; Path=/',
      'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
    ]);
    expect(html).toContain('<main>Edge runtime</main>');
    expect(html).toContain('</div></body></html>');
  });
});
