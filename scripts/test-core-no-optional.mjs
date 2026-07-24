import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('Run this proof through npm: npm run test:core:no-optional');
}

const directory = await mkdtemp(join(tmpdir(), 'vite-ssr-boost-core-'));
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

  const proof = `
    const { default: createHandler } = await import(${JSON.stringify(
      pathToFileURL(join(packageRoot, 'core', 'handler.js')).href,
    )});
    const { default: adapterEdge } = await import(${JSON.stringify(
      pathToFileURL(join(packageRoot, 'adapters', 'edge.js')).href,
    )});
    const { default: adapterNode } = await import(${JSON.stringify(
      pathToFileURL(join(packageRoot, 'adapters', 'node.js')).href,
    )});
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

  execFileSync(process.execPath, ['--input-type=module', '--eval', proof], {
    cwd: directory,
    stdio: 'inherit',
  });
} finally {
  await rm(directory, { force: true, recursive: true });
}
