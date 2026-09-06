import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Miniflare } from 'miniflare';

export const createWorkerFixture = async ({ keep = false } = {}) => {
  const root = resolve(import.meta.dirname, '../..');
  const directory = await mkdtemp(join(tmpdir(), 'ssr-boost-worker-'));
  const env = {
    ...process.env,
    PATH: `${join(directory, 'node_modules/.bin')}:${process.env.PATH}`,
  };
  delete env.NO_COLOR;
  const run = (command, args) =>
    execFileSync(command, args, { cwd: directory, env, stdio: 'inherit' });
  const dispose = () =>
    keep
      ? console.info(`Worker fixture retained: ${directory}`)
      : rm(directory, { force: true, recursive: true });
  try {
    const fixture = join(root, '__fixtures__/worker-template');
    for (const file of await readdir(fixture, { recursive: true })) {
      if (!file.endsWith('.txt')) continue;
      const target = join(directory, file.slice(0, -4));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(join(fixture, file)));
    }
    const packed = execFileSync(
      'npm',
      ['pack', join(root, 'lib'), '--ignore-scripts', '--json', '--pack-destination', directory],
      { cwd: root, env, encoding: 'utf8' },
    );
    const [archive] = JSON.parse(packed);
    const packages = [join(directory, archive.filename)];
    for (const name of [
      'vite',
      'react',
      'react-dom',
      'react-router',
      'wrangler',
      'typescript',
      '@cloudflare/workers-types',
      '@types/react',
      '@types/react-dom',
      '@babel/generator',
      '@babel/parser',
      '@babel/traverse',
      '@babel/types',
    ]) {
      const { version } = JSON.parse(
        await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'),
      );
      packages.push(`${name}@${version}`);
    }
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...packages]);
    run(process.execPath, [
      join(directory, 'node_modules/@lomray/vite-ssr-boost/cli.js'),
      'build',
      '--focus-only',
      'all',
    ]);
    run(process.execPath, [
      join(directory, 'node_modules/typescript/bin/tsc'),
      '--project',
      'tsconfig.worker.json',
    ]);
    console.info('PASS Worker entry satisfies ExportedHandler<Env> with Cloudflare globals');
    const manifest = JSON.parse(
      await readFile(join(directory, 'build/client/assets-manifest.json'), 'utf8'),
    );
    assert.deepEqual(
      manifest,
      JSON.parse(await readFile(join(directory, 'build/server/assets-manifest.json'), 'utf8')),
    );
    assert.ok(
      manifest.about.some((asset) => asset.type === 'style'),
      'CLI must generate lazy route CSS',
    );
    run(process.execPath, [
      join(directory, 'node_modules/wrangler/bin/wrangler.js'),
      'deploy',
      '--dry-run',
      '--outdir',
      '.worker-bundle',
    ]);
    const scriptPath = join(directory, '.worker-bundle/worker.js');
    const script = await readFile(scriptPath, 'utf8');
    assert.doesNotMatch(
      script,
      /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]node:/,
      'Worker must bundle without Node builtins',
    );
    console.info(
      'Worker fixture: packed install, CLI client/server/worker build and Wrangler dry run passed',
    );
    return { directory, manifest, scriptPath, dispose, run };
  } catch (error) {
    await dispose();
    throw error;
  }
};

export const bootWorkerFixture = async (fixture, port) => {
  const config = JSON.parse(await readFile(join(fixture.directory, 'wrangler.jsonc'), 'utf8'));
  assert.equal(
    config.compatibility_flags,
    undefined,
    'Minimal Worker must not require nodejs_compat',
  );
  const runtime = new Miniflare({
    modules: [
      { type: 'ESModule', path: 'worker.js', contents: await readFile(fixture.scriptPath, 'utf8') },
    ],
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: [],
    host: '127.0.0.1',
    port,
    assets: {
      directory: join(fixture.directory, config.assets.directory),
      binding: config.assets.binding,
      routerConfig: {
        has_user_worker: true,
        invoke_user_worker_ahead_of_assets: config.assets.run_worker_first,
      },
      assetConfig: {
        html_handling: config.assets.html_handling,
        not_found_handling: config.assets.not_found_handling,
      },
    },
    kvNamespaces: config.kv_namespaces.map(({ binding }) => binding),
  });
  try {
    await runtime.ready;
    const kv = await runtime.getKVNamespace('MESSAGES');
    await kv.put('greeting', 'Hello from KV');
    return { runtime, kv };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
};
