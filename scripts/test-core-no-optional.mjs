import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  const archive = execFileSync(
    process.execPath,
    [npmCli, 'pack', './lib', '--ignore-scripts', '--pack-destination', directory, '--silent'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
    },
  ).trim();

  if (!archive.endsWith('.tgz')) {
    throw new Error('npm pack did not produce an archive.');
  }

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
  const proof = `
    const { default: createHandler } = await import(${JSON.stringify(
      pathToFileURL(join(packageRoot, 'core', 'handler.js')).href,
    )});
    const { default: adapterEdge } = await import(${JSON.stringify(
      pathToFileURL(join(packageRoot, 'adapters', 'edge.js')).href,
    )});
    const response = await adapterEdge(async () => new Response('core-ok'))(
      new Request('https://edge.example/')
    );
    if (typeof createHandler !== 'function' || await response.text() !== 'core-ok') {
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
