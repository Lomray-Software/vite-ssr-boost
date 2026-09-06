// Reproduce the optional Cloudflare Vite integration assessment in a temporary app.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorkerFixture } from './helpers/worker-fixture.mjs';

const fixture = await createWorkerFixture();
let child;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
try {
  const { version } = JSON.parse(
    await readFile(
      new URL('../node_modules/@cloudflare/vite-plugin/package.json', import.meta.url),
      'utf8',
    ),
  );
  fixture.run('npm', [
    'install',
    '--save-dev',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `@cloudflare/vite-plugin@${version}`,
  ]);
  const config = JSON.parse(await readFile(join(fixture.directory, 'wrangler.jsonc'), 'utf8'));
  config.main = 'src/worker-dev.ts';
  delete config.assets.directory;
  await writeFile(join(fixture.directory, 'wrangler.dev.jsonc'), JSON.stringify(config, null, 2));
  const worker = await readFile(join(fixture.directory, 'src/worker.ts'), 'utf8');
  await writeFile(
    join(fixture.directory, 'src/worker-dev.ts'),
    worker.replace(
      "import manifest from '../build/client/assets-manifest.json';",
      'const manifest = {};',
    ),
  );
  const viteConfig = await readFile(join(fixture.directory, 'vite.config.ts'), 'utf8');
  await writeFile(
    join(fixture.directory, 'vite.dev.config.ts'),
    `import { cloudflare } from '@cloudflare/vite-plugin';\n${viteConfig.replace('plugins: [SsrBoost', "plugins: [cloudflare({ configPath: '../wrangler.dev.jsonc', viteEnvironment: { name: 'ssr' } }), SsrBoost")}`,
  );
  const env = { ...process.env };
  delete env.NO_COLOR;
  const stop = async () => {
    if (child && child.exitCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
      await closed;
      clearTimeout(timeout);
    }
  };
  const start = async () => {
    child = spawn(
      process.execPath,
      [
        join(fixture.directory, 'node_modules/vite/bin/vite.js'),
        '--config',
        'vite.dev.config.ts',
        '--host',
        '127.0.0.1',
        '--port',
        '4181',
        '--strictPort',
      ],
      { cwd: fixture.directory, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    const capture = (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    for (let i = 0; !output.includes('Local:') && i < 300; i++) {
      if (child.exitCode !== null) throw new Error('Vite exited before startup');
      await delay(100);
    }
  };
  await start();
  const origin = 'http://127.0.0.1:4181';
  const inspect = async (path) => {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20_000) });
    const html = await response.text();
    console.info(
      `Vite probe ${path}: ${response.status}; SSR=${html.includes('window.__staticRouterHydrationData')}; Vite client=${html.includes('/@vite/client')}`,
    );
    return { response, html };
  };
  let home = await inspect('/');
  if (home.response.status !== 200) {
    console.info(
      'Assets-backed HTML shell: GAP (see binding error above); trying the supported inline indexHtml option.',
    );
    const inlineWorker = worker
      .replace(
        "import manifest from '../build/client/assets-manifest.json';",
        "import indexHtml from './index.html?raw';\nconst manifest = {};",
      )
      .replace(
        "getHtml: async (_request, env) => (await getHtmlFromAssets(env, '/index.html'))(),",
        'indexHtml, assets: false,',
      );
    await writeFile(join(fixture.directory, 'src/worker-dev.ts'), inlineWorker);
    await stop();
    await start();
    home = await inspect('/');
  }
  console.info(
    `Module loading: ${home.response.status === 200 && home.html.includes('Worker home') ? 'PASS Worker SSR' : 'GAP Worker SSR failed'}`,
  );
  const about = await inspect('/about');
  console.info(
    `Lazy CSS in initial SSR HTML: ${about.html.includes('window.__staticRouterHydrationData') && /about\.css|\.about\s*\{/.test(about.html) ? 'present' : 'GAP absent'}`,
  );
  const css = await fetch(`${origin}/about.css`);
  console.info(
    `Vite CSS module: ${css.status}; ${(await css.text()).includes('12, 34, 56') ? 'style available' : 'style absent'}`,
  );
  const bindings = await inspect('/bindings');
  console.info(
    `Bindings: ${bindings.response.status === 200 && bindings.response.headers.get('X-Worker-Hook') === 'ready' ? 'KV read and waitUntil reached workerd' : 'GAP request failed'}`,
  );
  const filename = join(fixture.directory, 'src/About.tsx');
  const original = await readFile(filename, 'utf8');
  await writeFile(filename, original.replace('Lazy Worker route', 'Worker module updated'));
  let updated = false;
  for (let i = 0; i < 50; i++) {
    const html = await fetch(`${origin}/about`).then((response) => response.text());
    if (html.includes('Worker module updated')) {
      updated = true;
      break;
    }
    await delay(100);
  }
  console.info(`SSR module reload after edit: ${updated ? 'PASS' : 'GAP no update'}`);
  const client = await inspect('/client.tsx');
  console.info(`Browser entry module loading: ${client.response.status}`);
  console.info(
    'Browser HMR and hydration: not run (requires browser); HTTP module reload is not proof of browser HMR.',
  );
  console.info(
    `Cloudflare Vite plugin ${version} probe complete; use ssr-boost dev until SSR lazy CSS and browser hydration/HMR work end to end.`,
  );
  assert.ok(child.exitCode === null, 'Vite must remain running during probe');
} finally {
  if (child && child.exitCode === null) {
    const closed = once(child, 'close');
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(timeout);
  }
  await fixture.dispose();
}
