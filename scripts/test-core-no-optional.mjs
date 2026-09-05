import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('Run this proof through npm: npm run test:core:no-optional');
}

const directory = await realpath(await mkdtemp(join(tmpdir(), 'vite-ssr-boost-core-')));
const projectRoot = process.cwd();
const runNpm = (args) =>
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd: directory,
    stdio: 'inherit',
  });

try {
  execFileSync(
    process.execPath,
    [npmCli, 'pack', './lib', '--ignore-scripts', '--pack-destination', directory, '--silent'],
    {
      cwd: projectRoot,
      stdio: 'ignore',
    },
  );
  const archives = (await readdir(directory)).filter((filename) => filename.endsWith('.tgz'));

  if (archives.length !== 1) {
    throw new Error('npm pack did not produce an archive.');
  }

  const [archive] = archives;
  const dependencies = {
    '@lomray/vite-ssr-boost': `file:./${archive}`,
  };
  const addLocalDependency = async (name) => {
    if (dependencies[name]) {
      return;
    }

    const location = join(projectRoot, 'node_modules', ...name.split('/'));
    const metadata = JSON.parse(await readFile(join(location, 'package.json'), 'utf8'));

    dependencies[name] = `file:${location}`;

    for (const dependency of Object.keys(metadata.dependencies ?? {})) {
      await addLocalDependency(dependency);
    }
  };

  for (const dependency of [
    'chalk',
    'commander',
    'hoist-non-react-statics',
    'json5',
    'react',
    'react-dom',
    'react-router',
  ]) {
    await addLocalDependency(dependency);
  }

  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ dependencies, private: true, type: 'module' }),
  );

  runNpm([
    'install',
    '--offline',
    '--omit=optional',
    '--legacy-peer-deps',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `./${archive}`,
  ]);

  for (const dependency of ['compression', 'express']) {
    try {
      await access(join(directory, 'node_modules', dependency));
      throw new Error(`${dependency} was installed despite --omit=optional.`);
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const packageRoot = join(directory, 'node_modules', '@lomray', 'vite-ssr-boost');
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

  // Removed entrypoints must not survive in npm archives as stale build output.
  for (const subpath of [
    'node/entry',
    'node/render',
    'node/server',
    'node/create-fetch-request',
    'node/write-response',
    'services/prepare-server',
    'helpers/handle-response',
    'adapters/express/write-response',
    'adapters/express/handle-response',
  ]) {
    for (const suffix of ['.js', '.d.ts', '.js.map', '.d.ts.map']) {
      await assert.rejects(access(join(packageRoot, subpath + suffix)), { code: 'ENOENT' });
    }
  }

  for (const dependency of ['compression', 'express']) {
    if (packageJson.dependencies?.[dependency]) {
      throw new Error(`${dependency} is still a required runtime dependency.`);
    }
  }

  if (!((await stat(join(packageRoot, 'cli.js'))).mode & 0o111)) {
    throw new Error('The packed CLI is not executable after installation.');
  }

  const assertRuntimeClean = async (relativeDirectory) => {
    const directoryPath = join(packageRoot, relativeDirectory);

    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      const relativePath = join(relativeDirectory, entry.name);

      if (entry.isDirectory()) {
        await assertRuntimeClean(relativePath);
      } else if (entry.name.endsWith('.js')) {
        const code = await readFile(join(packageRoot, relativePath), 'utf8');

        if (/(?:from|import\()\s*["'](?:compression|express)["']/.test(code)) {
          throw new Error(`${relativePath} imports an optional adapter dependency.`);
        }

        if (
          /(?:from|import\()\s*["'](?:node:|fs["']|http["']|https["']|path["']|url["'])/.test(
            code,
          )
        ) {
          throw new Error(`${relativePath} imports a Node runtime module.`);
        }
      }
    }
  };

  await assertRuntimeClean('core');
  await assertRuntimeClean('edge');

  // Exercise the installed package name: file URLs would bypass the exports map.
  const files = (await readdir(packageRoot, { recursive: true }))
    .filter((file) => /\.(?:js|d\.ts|map|json|md)$/.test(file) || /(?:LICENSE|Dockerfile)$/.test(file));
  const resolutions = files.flatMap((file) => [
    [file, pathToFileURL(join(packageRoot, file)).href],
    ...(file.endsWith('.js') ? [[file.slice(0, -3), pathToFileURL(join(packageRoot, file)).href]] : []),
  ]);

  const proof = `
    import assert from 'node:assert/strict';
    for (const [subpath, expected] of ${JSON.stringify(resolutions)}) {
      assert.equal(import.meta.resolve('@lomray/vite-ssr-boost/' + subpath), expected, subpath);
    }
    const { default: createHandler } = await import('@lomray/vite-ssr-boost/core/handler');
    const { default: adapterEdge } = await import('@lomray/vite-ssr-boost/adapters/edge');
    const { default: adapterNode } = await import('@lomray/vite-ssr-boost/adapters/node');
    assert.equal(createHandler, (await import('@lomray/vite-ssr-boost/core/handler.js')).default);
    assert.equal(adapterEdge, (await import('@lomray/vite-ssr-boost/adapters/edge.js')).default);
    assert.equal(adapterNode, (await import('@lomray/vite-ssr-boost/adapters/node.js')).default);
    const response = await adapterEdge(async () => new Response('core-ok'))(
      new Request('https://edge.example/')
    );
    if (
      typeof createHandler !== 'function' ||
      typeof adapterNode !== 'function' ||
      await response.text() !== 'core-ok'
    ) {
      throw new Error('Core/edge runtime proof failed.');
    }
  `;

  const runtimeProof = join(directory, 'consumer.mjs');

  await writeFile(runtimeProof, proof);
  execFileSync(process.execPath, [runtimeProof], {
    cwd: directory,
    stdio: 'inherit',
  });

  const typeProof = join(directory, 'consumer.mts');

  await writeFile(typeProof, `
    import adapterEdge from '@lomray/vite-ssr-boost/adapters/edge';
    import adapterEdgeJs from '@lomray/vite-ssr-boost/adapters/edge.js';
    import type { TSsrHandler } from '@lomray/vite-ssr-boost/core/types';
    import type { TSsrHandler as TSsrHandlerJs } from '@lomray/vite-ssr-boost/core/types.js';

    const handler: TSsrHandler = async (request) => new Response(request.url);
    const handlerJs: TSsrHandlerJs = handler;
    const response: Response = await adapterEdge(handler)(new Request('https://example.com'));
    const responseJs: Response = await adapterEdgeJs(handlerJs)(new Request('https://example.com'));
    // @ts-expect-error A handler must return a Response, not a string.
    const invalid: TSsrHandler = async () => 'invalid';
    // @ts-expect-error The adapter requires a Fetch Request.
    adapterEdge(handler)('https://example.com');
  `);

  for (const [module, moduleResolution] of [
    [ts.ModuleKind.NodeNext, ts.ModuleResolutionKind.NodeNext],
    [ts.ModuleKind.ESNext, ts.ModuleResolutionKind.Bundler],
  ]) {
    const options = { module, moduleResolution, noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022 };

    for (const file of files.filter((name) => name.endsWith('.d.ts'))) {
      const subpath = file.slice(0, -5);

      for (const suffix of ['', '.js', '.d.ts']) {
        const { resolvedModule } = ts.resolveModuleName(
          `@lomray/vite-ssr-boost/${subpath}${suffix}`, typeProof, options, ts.sys,
        );

        if (resolvedModule?.resolvedFileName !== join(packageRoot, file)) {
          throw new Error(`Declaration resolution failed: ${subpath}${suffix} (${moduleResolution}).`);
        }
      }
    }

    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([typeProof], options));

    if (diagnostics.length) {
      throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => directory,
        getNewLine: () => '\n',
      }));
    }
  }

  process.stdout.write('Packed exports, NodeNext/Bundler declarations and optional-free core passed.\n');
} finally {
  await rm(directory, { force: true, recursive: true });
}
