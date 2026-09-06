import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const repository = fileURLToPath(new URL('..', import.meta.url));

const copyFixture = (root, name) => {
  const source = path.join(repository, '__fixtures__', 'init', name);
  for (const file of fs.readdirSync(source, { recursive: true })) {
    if (!file.endsWith('.txt')) continue;
    const destination = path.join(root, file.slice(0, -4));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(source, file), destination);
  }
};

const port = async () => {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port: value } = server.address();
  server.close();
  await once(server, 'close');
  return value;
};

const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await closed; } finally { clearTimeout(timeout); }
};

/** Fail before packing/building when this runtime cannot run the installed dependency tree. */
export function assertNodeEngines(root = repository, version = process.versions.node) {
  const failures = [];
  const visited = new Set();
  const inspect = (directory) => {
    const location = fs.realpathSync(directory);
    if (visited.has(location)) return;
    visited.add(location);
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (pkg.engines?.node && !semver.satisfies(version, pkg.engines.node)) {
        failures.push(`${pkg.name ?? 'app'}: ${pkg.engines.node}`);
      }
    }
    const modules = path.join(directory, 'node_modules');
    if (!fs.existsSync(modules)) return;
    for (const name of fs.readdirSync(modules)) {
      if (name.startsWith('.')) continue;
      const dependency = path.join(modules, name);
      if (!fs.statSync(dependency).isDirectory()) continue;
      if (name.startsWith('@')) {
        for (const scoped of fs.readdirSync(dependency)) inspect(path.join(dependency, scoped));
      } else inspect(dependency);
    }
  };
  inspect(root);
  assert.equal(failures.length, 0, `Stock-app end-to-end precondition failed: Node ${version} does not satisfy installed dependencies' engines: ${[...new Set(failures)].join('; ')}. Use Node 22.23.2 (the verified runtime) or another version satisfying these ranges before running this test.`);
}

/** Exercise published CLI entrypoints, actual Vite builds, and HTTP output. */
export default async function testInit() {
  assertNodeEngines();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssr-boost-init-e2e-'));
  const env = { ...process.env, HUSKY: '0', npm_config_ignore_scripts: 'true' };
  delete env.NO_COLOR;
  // No shell commands, no lifecycle scripts, and a PID-owned server in each proof.
  const run = (program, args, cwd = root) => {
    try {
      return execFileSync(program, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      throw new Error(`${program} ${args.join(' ')} failed (${error.status}):\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
    }
  };
  const write = (file, code) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), code);
  };
  const cli = path.join(root, 'node_modules', '@lomray', 'vite-ssr-boost', 'cli.js');
  const verify = async (label) => {
    run(process.execPath, [cli, 'build']);
    const available = await port();
    const child = spawn(process.execPath, [cli, 'start', '--port', String(available)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    try {
      const origin = `http://127.0.0.1:${available}`;
      let response;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(output);
        try {
          response = await fetch(`${origin}/about`, { signal: AbortSignal.timeout(2000) });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      assert.ok(response, `${label}: server did not start\n${output}`);
      const html = await response.text();
      assert.equal(response.status, 200, `${label}: ${html}\n${output}`);
      assert.match(html, /About route rendered on server/, label);
      assert.match(html, /window\.__staticRouterHydrationData/, label);
      assert.match(html, /<script[^>]+type="module"[^>]+src=|<script[^>]+src=[^>]+type="module"/, label);
      const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
      assert.ok(styles.length, `${label}: lazy stylesheet link missing\n${html}`);
      const css = await Promise.all(styles.map(async ([, href]) => {
        const asset = await fetch(new URL(href, origin));
        assert.equal(asset.status, 200);
        return asset.text();
      }));
      assert.ok(css.some((code) => code.includes('.about-page')), `${label}: lazy route's own stylesheet was lost`);
      const doctor = JSON.parse(run(process.execPath, [cli, 'doctor', '--json', '--bundle', 'support.json']));
      assert.ok(doctor.checks.every((check) => check.status === 'ok'), `${label}: ${JSON.stringify(doctor.checks)}`);
      console.info(`${label}: SSR deep link, hydration, lazy CSS, and doctor passed`);
    } finally {
      await stop(child);
    }
  };
  try {
    run('npm', ['run', 'build'], repository);
    const packed = JSON.parse(run('npm', ['pack', path.join(repository, 'lib'), '--ignore-scripts', '--json', '--pack-destination', root], repository))[0].filename;
    copyFixture(root, 'stock-react-ts');
    // Start with the vendored create-vite React TS counter, then add Data-mode routes.
    let main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
    main = main.replace("import App from './App.tsx'", "import App from './App.tsx'\nimport { createBrowserRouter, RouterProvider } from 'react-router'\n\nconst routes = [\n  { path: '/', Component: App },\n  { path: '/about', lazy: () => import('./About') },\n]\nconst router = createBrowserRouter(routes)").replace('<StrictMode><App /></StrictMode>', '<StrictMode><RouterProvider router={router} /></StrictMode>');
    write('src/main.tsx', main);
    write('src/About.tsx', "import './about.css'\nexport function Component() { return <h1 className=\"about-page\">About route rendered on server</h1> }\n");
    write('src/about.css', '.about-page { color: rgb(1, 2, 3); }\n');
    // init must also work before the app has installed the library.
    run(process.execPath, [path.join(repository, 'lib/cli.js'), 'init', '--root', root, '--apply'], repository);
    const packageFile = path.join(root, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const packages = ['react', 'react-dom', 'react-router', 'vite', '@babel/parser', '@babel/traverse', '@babel/generator', '@babel/types'];
    for (const name of packages) {
      const version = JSON.parse(fs.readFileSync(path.join(repository, 'node_modules', name, 'package.json'), 'utf8')).version;
      if (name === 'vite' || name.startsWith('@babel')) pkg.devDependencies[name] = version;
      else pkg.dependencies[name] = version;
    }
    const viteMajor = Number(pkg.devDependencies.vite.split('.')[0]);
    pkg.devDependencies['@vitejs/plugin-react'] = viteMajor >= 8 ? '6.1.1' : viteMajor === 7 ? '^5.1.0' : '^4.7.0';
    pkg.dependencies['@lomray/vite-ssr-boost'] = `file:./${packed}`;
    write('package.json', JSON.stringify(pkg, null, 2));
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    assertNodeEngines(root);
    env.PATH = `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${env.PATH}`;
    run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
    assert.match(run(process.execPath, [cli, 'init', '--apply']), /No changes/);
    await verify('stock create-vite react-ts + Data router');

    const dependencyPackage = fs.readFileSync(packageFile, 'utf8');
    for (const layout of ['root-inline', 'src-export', 'javascript', 'alias-wrapper']) {
      for (const file of ['src', 'index.html', 'vite.config.ts', 'vite.config.js', 'tsconfig.json']) {
        fs.rmSync(path.join(root, file), { recursive: true, force: true });
      }
      copyFixture(root, layout);
      write('package.json', dependencyPackage);
      run(process.execPath, [cli, 'init', '--apply']);
      await verify(`init layout ${layout}`);
    }
    // Built-ins and an unwrapped RouterProvider must also work through the generated App.
    for (const wrapper of ['fragment', 'none']) {
      for (const file of ['src', 'index.html', 'vite.config.ts', 'tsconfig.json']) {
        fs.rmSync(path.join(root, file), { recursive: true, force: true });
      }
      copyFixture(root, 'root-inline');
      write('package.json', dependencyPackage);
      let main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
      main = main.replace('<StrictMode>', wrapper === 'fragment' ? '<>' : '').replace('</StrictMode>', wrapper === 'fragment' ? '</>' : '');
      write('src/main.tsx', main);
      run(process.execPath, [cli, 'init', '--apply']);
      await verify(`init wrapper ${wrapper}`);
    }
    // Return to the conventional root config before exercising the parser cases.
    write('vite.config.ts', "import SsrBoost from '@lomray/vite-ssr-boost/plugin';\nimport react from '@vitejs/plugin-react';\nexport default { plugins: [SsrBoost({ clientFile: 'src/main.tsx', serverFile: 'src/server.ts' }), react()] };\n");

    // Each parser compatibility fixture must preserve its lazy CSS in an actual SSR response.
    for (const filename of fs.readdirSync(path.join(repository, '__fixtures__/routes'))) {
      const fixture = JSON.parse(fs.readFileSync(path.join(repository, '__fixtures__/routes', filename), 'utf8'));
      write('src/main.tsx', `import { Fragment as App } from 'react';\n${fixture.client ?? "import boot from '@lomray/vite-ssr-boost/browser/entry';\nimport routes from './routes';\nvoid boot(App, routes);\n"}`);
      write('src/routes.ts', fixture.routes);
      write('src/server.ts', "import entry from '@lomray/vite-ssr-boost/adapters/express/entry';\nimport { Fragment } from 'react';\nimport routes from './routes-server';\nexport default entry(Fragment, routes);\n");
      write('src/routes-server.ts', filename === 'named-alias.json' ? "export { list as default } from './routes';\n" : "export { default } from './routes';\n");
      for (const [file, code] of Object.entries(fixture.files ?? {})) write(`src/${file}`, code);
      await verify(filename.replace('.json', ''));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await testInit();
}
