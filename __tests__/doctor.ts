// @vitest-environment node
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFixture, writeFixture } from '@__helpers__/project-fixture';
import runDoctor, {
  inspectProject,
  reactCopies,
  resolveNpmCli,
  supportBundle,
  TESTED_MATRIX,
} from '@cli/doctor';
import runInit from '@cli/init';
import { libraryPackage } from '@cli/project';

const directories: string[] = [];
const installed = {
  '@lomray/vite-ssr-boost': libraryPackage().version,
  react: '19.2.8',
  'react-dom': '19.2.8',
  'react-router': '8.3.1',
  vite: '8.2.2',
};
const fixture = () => {
  const root = copyFixture('root-inline');
  directories.push(root);
  runInit({ root, apply: true });
  for (const [name, version] of Object.entries(installed)) {
    writeFixture(
      root,
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, version, engines: { node: '>=22.12.0' } }),
    );
  }
  return root;
};
const mutate = (root: string, file: string, edit: (text: string) => string) =>
  writeFixture(root, file, edit(fs.readFileSync(path.join(root, file), 'utf8')));
const check = (root: string, name: string) =>
  inspectProject({ root }).checks.find((row) => row.name === name)!;

beforeEach(() => {
  vi.spyOn(childProcess, 'execFileSync').mockReturnValue(
    JSON.stringify({
      dependencies: { react: { version: '19.2.8' }, 'react-dom': { version: '19.2.8' } },
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  directories
    .splice(0)
    .forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  process.exitCode = 0;
});

describe('doctor', () => {
  it.each([
    { label: 'npm_execpath before either bundled layout', available: [0, 1, 2], selected: 0 },
    { label: 'Unix runtime layout before Windows layout', available: [1, 2], selected: 1 },
    { label: 'Windows runtime layout', available: [2], selected: 2 },
    { label: 'bare npm only when no CLI exists', available: [], selected: undefined },
  ])('resolves $label and preserves the React-copy result', ({ available, selected }) => {
    const candidates = [
      path.resolve('/npm-execpath/bin/npm-cli.js'),
      path.join(
        path.dirname(process.execPath),
        '..',
        'lib',
        'node_modules',
        'npm',
        'bin',
        'npm-cli.js',
      ),
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
    vi.stubEnv('npm_execpath', candidates[0]);
    vi.spyOn(fs, 'existsSync').mockImplementation((file) =>
      available.some((index) => file === candidates[index]),
    );
    const npmCli = selected === undefined ? undefined : candidates[selected];
    expect(resolveNpmCli()).toBe(npmCli);
    const root = path.resolve('/app');
    expect(reactCopies(root)).toEqual({ react: 1, 'react-dom': 1 });
    const args = ['ls', 'react', 'react-dom', '--json', '--all', '--long'];
    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      npmCli ? process.execPath : 'npm',
      npmCli ? [npmCli, ...args] : args,
      expect.objectContaining({ cwd: root, shell: false }),
    );
  });

  it('uses the runtime npm when npm_execpath is unset', () => {
    vi.stubEnv('npm_execpath', undefined);
    const npmCli = path.join(
      path.dirname(process.execPath),
      '..',
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    );
    vi.spyOn(fs, 'existsSync').mockImplementation((file) => file === npmCli);
    expect(resolveNpmCli()).toBe(npmCli);
  });

  it('keeps the published matrix synchronized with the actual CI matrix', () => {
    const workflow = fs.readFileSync('.github/workflows/react-compatibility.yml', 'utf8');
    const rows = [
      ...workflow.matchAll(/- react: '([^']+)'\s+router: '([^']+)'\s+vite: '([^']+)'/g),
    ].map(([, react, router, vite]) => ({ react, router, vite }));
    expect(TESTED_MATRIX).toEqual(rows);
  });

  it('prints JSON, reports every check ok, and exits zero for a migrated project', () => {
    const root = fixture();
    const info = vi.spyOn(console, 'info');
    runDoctor({ root, json: true });
    expect(process.exitCode).toBe(0);
    const report = JSON.parse(info.mock.calls[0][0]) as ReturnType<typeof inspectProject>;
    expect(report.checks.every((row) => row.status === 'ok' && row.fix)).toBe(true);
    expect(report.routes).toEqual([
      { id: '0', path: '/' },
      { id: '1', path: '/about' },
    ]);
    expect(report.adapter).toBe('express');
  });

  it.each(Object.keys(installed))('reports a missing %s version as an error', (name) => {
    const root = fixture();
    fs.rmSync(path.join(root, 'node_modules', name), { recursive: true });
    expect(check(root, `version:${name}`).status).toBe('error');
  });

  it.each(TESTED_MATRIX)('accepts the exact tested row %j', (row) => {
    const root = fixture();
    for (const [name, version] of Object.entries({
      react: row.react,
      'react-dom': row.react,
      'react-router': row.router,
      vite: row.vite,
    })) {
      mutate(root, `node_modules/${name}/package.json`, (code) =>
        JSON.stringify({ ...JSON.parse(code), version }),
      );
    }
    expect(check(root, 'compatibility').status).toBe('ok');
  });

  it('reports one compatibility warning and names the installed trio and closest tested row', () => {
    const root = fixture();
    mutate(root, 'node_modules/react-router/package.json', (code) =>
      code.replace('8.3.1', '7.18.3'),
    );
    const report = inspectProject({ root });
    expect(report.checks.filter((item) => item.status === 'warn')).toEqual([
      expect.objectContaining({
        name: 'compatibility',
        message:
          'React 19.2.8 + Router 7.18.3 + Vite 8.2.2 is not a tested row; closest: React 19.2.8 + Router 7.18.3 + Vite 7.3.6',
      }),
    ]);
    expect(
      report.checks
        .filter((item) => item.name.startsWith('version:'))
        .every((item) => item.status === 'ok'),
    ).toBe(true);
    expect(report.checks.every((item) => !item.fix.includes('\n'))).toBe(true);
    runDoctor({ root, json: true });
    expect(process.exitCode).toBe(0);
  });

  it('includes a mismatched React DOM version in the compatibility warning', () => {
    const root = fixture();
    mutate(root, 'node_modules/react-dom/package.json', (code) => code.replace('19.2.8', '18.2.0'));
    expect(check(root, 'compatibility')).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('React 19.2.8 (React DOM 18.2.0)'),
    });
  });

  it('checks peer ranges independently of matrix compatibility', () => {
    const root = fixture();
    mutate(root, 'node_modules/react/package.json', (code) => code.replace('19.2.8', '17.0.2'));
    expect(check(root, 'version:react')).toMatchObject({
      status: 'error',
      message: expect.stringContaining('@lomray/vite-ssr-boost requires react: >=18.2.0'),
    });
    mutate(root, 'node_modules/react-dom/package.json', (code) =>
      JSON.stringify({ ...JSON.parse(code), peerDependencies: { react: '^19.2.8' } }),
    );
    expect(check(root, 'version:react').message).toContain('react-dom requires react: ^19.2.8');
    expect(check(root, 'version:vite').status).toBe('ok');
  });

  it('checks installed dependency engines as well as the app engine', () => {
    const root = fixture();
    mutate(root, 'node_modules/react-router/package.json', (code) =>
      JSON.stringify({ ...JSON.parse(code), engines: { node: '>=999' } }),
    );
    expect(check(root, 'node')).toMatchObject({
      status: 'error',
      message: expect.stringContaining('react-router: >=999'),
    });
  });

  it.each([
    ['package', 'package.json', () => '{invalid'],
    [
      'node',
      'package.json',
      (code: string) => JSON.stringify({ ...JSON.parse(code), engines: { node: '>=999' } }),
    ],
    ['vite-plugin', 'vite.config.ts', () => 'export default { plugins: [] };'],
    [
      'html-module',
      'index.html',
      (code: string) => code.replace('type="module"', 'type="text/plain"'),
    ],
    ['html-outlet', 'index.html', (code: string) => code.replace('<!--ssr-outlet-->', '')],
    [
      'html-outlet',
      'index.html',
      (code: string) => code.replace('<!--ssr-outlet-->', '<!--ssr-outlet--><!--ssr-outlet-->'),
    ],
    ['browser-entry', 'src/main.tsx', () => 'export default {};'],
    ['server-entry', 'src/server.ts', () => 'export default {};'],
    ['routes', 'src/routes.ssr.tsx', () => 'export default makeRoutes();'],
    ['scripts', 'package.json', (code: string) => code.replace('ssr-boost build', 'vite build')],
  ] as const)('fails %s with a one-line fix', (name, file, edit) => {
    const root = fixture();
    mutate(root, file, edit);
    const result = check(root, name);
    expect(result.status).toBe('error');
    expect(result.fix).toBeTruthy();
    if (name === 'routes')
      expect(result.message).toMatch(/routes.ssr.tsx:1:16: Unsupported routes array/);
    runDoctor({ root, json: true });
    expect(process.exitCode).toBe(1);
  });

  it('counts physical duplicate React copies, including equal versions, and ignores deduped references', () => {
    const root = fixture();
    vi.mocked(childProcess.execFileSync).mockReturnValue(
      JSON.stringify({
        dependencies: {
          react: { version: '19.2.8', path: `${root}/react` },
          'react-dom': {
            version: '19.2.8',
            path: `${root}/dom`,
            dependencies: { react: { version: '19.2.8', path: `${root}/react` } },
          },
          component: { dependencies: { react: { version: '19.2.8', path: `${root}/duplicate` } } },
        },
      }),
    );
    expect(reactCopies(root)).toEqual({ react: 2, 'react-dom': 1 });
    expect(check(root, 'react-copies').status).toBe('error');
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('npm unavailable');
    });
    expect(check(root, 'react-copies').status).toBe('error');
  });

  it('reports robots policies and size budgets as information without editing them', () => {
    const root = fixture();
    expect(check(root, 'robots').message).toContain('No robots.txt');
    expect(check(root, 'size-budget')).toMatchObject({
      status: 'ok',
      info: true,
      message: 'No size budget script (informational)',
    });
    writeFixture(root, 'public/robots.txt', 'User-agent: *\nDisallow: /\n');
    expect(check(root, 'robots')).toMatchObject({ status: 'ok', info: true });
    expect(check(root, 'robots').message).toContain('blocks crawling');
    writeFixture(root, 'public/robots.txt', 'User-agent: *\nAllow: /\n');
    expect(check(root, 'robots').message).toContain('custom/allow');
    mutate(root, 'package.json', (code) =>
      JSON.stringify({
        ...JSON.parse(code),
        scripts: { ...JSON.parse(code).scripts, 'size:check': 'node scripts/size-budget.mjs' },
      }),
    );
    expect(check(root, 'size-budget').message).toBe('Size budget script present');
    expect(fs.readFileSync(path.join(root, 'public/robots.txt'), 'utf8')).toContain('Allow: /');
  });

  it('reports bundle write failures and counts markers inside inline scripts like the SSR shell splitter', () => {
    const root = fixture();
    mutate(
      root,
      'index.html',
      (code) => code + '<script>const marker = "<!--ssr-outlet-->";</script>',
    );
    expect(check(root, 'html-outlet').status).toBe('error');
    const info = vi.spyOn(console, 'info');
    runDoctor({ root, json: true, bundle: 'missing-directory/support.json' });
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(info.mock.calls.at(-1)![0]).checks.at(-1)).toMatchObject({
      name: 'bundle',
      status: 'error',
    });
  });

  it('writes only allowlisted structural support data and recorded diagnostic codes', () => {
    const root = fixture();
    writeFixture(root, '.env', 'SECRET=secret-environment-value\n');
    writeFixture(
      root,
      'dist/ssr-boost-diagnostics.json',
      JSON.stringify({
        codes: ['SSR_BOOST_OUTLET_MISSING', 'secret-recorded-value'],
        cookie: 'session=secret-cookie-value',
      }),
    );
    writeFixture(
      root,
      'src/routes.ssr.tsx',
      "export default [{ id: 'about', path: '/about', handle: { data: 'secret-app-value' }, lazy: () => import('./About') }];",
    );
    const report = inspectProject({ root });
    report.checks.push({
      name: 'routes',
      status: 'error',
      fix: 'Use static routes.',
      message: 'secret-error-value',
    });
    expect(JSON.stringify(supportBundle(report))).not.toMatch(/secret-|session=/);
    runDoctor({ root, bundle: 'support.json', json: true });
    const bundle = fs.readFileSync(path.join(root, 'support.json'), 'utf8');
    expect(bundle).not.toMatch(/secret-|session=/);
    expect(JSON.parse(bundle).diagnosticCodes).toEqual(['SSR_BOOST_OUTLET_MISSING']);
    expect(JSON.parse(bundle).routes).toEqual([{ id: 'about', path: '/about' }]);
  });
});
