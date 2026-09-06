import childProcess from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import semver from 'semver';
import DIAGNOSTIC_CODES from '@cli/diagnostic-codes';
import {
  libraryPackage,
  objectProperty,
  readConfig,
  readHtml,
  readPackage,
  stringValue,
} from '@cli/project';
import type { IPackage, TProjectConfig } from '@cli/project';
import PLUGIN_NAME from '@constants/plugin-name';
import ParseRoutes from '@services/parse-routes';
import type { TRoutesTree } from '@services/parse-routes';
import ServerConfig from '@services/server-config';
import SourceFiles from '@services/source-files';

export interface IDoctorOptions {
  root?: string;
  json?: boolean;
  bundle?: string;
}

export interface ICheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix: string;
  info?: boolean;
}

export interface IDoctorReport {
  versions: Record<string, string | null>;
  adapter: string | null;
  routes: { id: string; path: string | null }[];
  checks: ICheck[];
  diagnosticCodes: string[];
}

// Kept in lockstep with .github/workflows/react-compatibility.yml by a unit test.
export const TESTED_MATRIX = [
  { react: '18.2.0', router: '7.18.3', vite: '6.4.3' },
  { react: '19.2.8', router: '7.18.3', vite: '7.3.6' },
  { react: '19.2.8', router: '8.3.1', vite: '8.2.2' },
];

interface INpmTree {
  version?: string;
  path?: string;
  deduped?: boolean;
  dependencies?: Record<string, INpmTree>;
}

/** Prefer npm's own CLI, then the npm bundled beside the current Node runtime. */
export const resolveNpmCli = (): string | undefined => {
  const directory = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(directory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
};

/** Inspect npm's dependency tree, counting physical copies rather than dependants. */
export const reactCopies = (root: string): { react: number; 'react-dom': number } => {
  let output: string;

  try {
    const npmCli = resolveNpmCli();
    const args = ['ls', 'react', 'react-dom', '--json', '--all', '--long'];

    output = childProcess.execFileSync(
      npmCli ? process.execPath : 'npm',
      npmCli ? [npmCli, ...args] : args,
      {
        cwd: root,
        shell: false,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  } catch (error) {
    const failed = error as { stdout?: string; signal?: string };

    if (!failed.stdout || failed.signal) {
      throw new Error(
        'npm ls failed; install dependencies and rerun npm ls react react-dom --json.',
      );
    }

    output = String(failed.stdout);
  }

  const copies = { react: new Set<string>(), 'react-dom': new Set<string>() };
  const visit = (node: INpmTree, directory: string): void => {
    for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
      const location = dependency.path ?? path.join(directory, 'node_modules', name);

      if ((name === 'react' || name === 'react-dom') && dependency.version && !dependency.deduped) {
        copies[name].add(fs.existsSync(location) ? fs.realpathSync(location) : location);
      }

      visit(dependency, location);
    }
  };

  visit(JSON.parse(output) as INpmTree, root);

  return { react: copies.react.size, 'react-dom': copies['react-dom'].size };
};

/** Match React Router's position-based fallback IDs, even below an explicitly named parent. */
const routeDetails = (routes: TRoutesTree[], parent = ''): IDoctorReport['routes'] =>
  routes.flatMap((route) => {
    const position = [parent, String(route.index)].filter(Boolean).join('-');

    return [
      { id: route.id ?? position, path: route.path ?? null },
      ...routeDetails(route.children, position),
    ];
  });

/** Read-only project inspection. The JSON schema is also usable from automation. */
export const inspectProject = (options: IDoctorOptions = {}): IDoctorReport => {
  const root = path.resolve(options.root ?? process.cwd());
  const checks: ICheck[] = [];
  const versions: IDoctorReport['versions'] = { node: process.versions.node };
  const report: IDoctorReport = {
    versions,
    adapter: null,
    routes: [],
    checks,
    diagnosticCodes: [],
  };
  const check = (name: string, fix: string, inspect: () => string, info = false): void => {
    try {
      checks.push({ name, status: 'ok', message: inspect(), fix, ...(info ? { info } : {}) });
    } catch (error) {
      checks.push({
        name,
        status: 'error',
        message: (error as Error).message,
        fix,
        ...(info ? { info } : {}),
      });
    }
  };
  let pkg: IPackage = {};

  check('package', 'Run doctor in the app directory or set --root.', () => {
    pkg = readPackage(path.join(root, 'package.json'));

    return 'package.json is readable';
  });

  const require = createRequire(path.join(root, 'package.json'));
  const packages = [PLUGIN_NAME, 'react', 'react-dom', 'react-router', 'vite'];
  const ownPackage = libraryPackage();
  const engines: Record<string, string> = { [PLUGIN_NAME]: ownPackage.engines!.node! };
  const peers: Record<string, Record<string, string>> = { app: pkg.peerDependencies ?? {} };

  for (const name of packages) {
    check(
      `version:${name}`,
      `Install ${name} at a version satisfying the installed packages’ peer ranges.`,
      () => {
        const metadata = readPackage(require.resolve(`${name}/package.json`));
        const version = semver.valid(metadata.version);

        peers[name] =
          metadata.peerDependencies ??
          (name === PLUGIN_NAME ? (ownPackage.peerDependencies ?? {}) : {});

        versions[name] = version;

        if (!version) {
          throw new Error(`${name} has no valid installed version`);
        }

        if (metadata.engines?.node) {
          engines[name] = metadata.engines.node;
        }

        return `${name} ${version}`;
      },
    );

    versions[name] ??= null;
  }

  for (const item of checks.filter(
    (row) => row.name.startsWith('version:') && row.status === 'ok',
  )) {
    const name = item.name.slice('version:'.length);
    const failures = Object.entries(peers).flatMap(([dependant, ranges]) =>
      ranges[name] && !semver.satisfies(versions[name]!, ranges[name])
        ? [`${dependant} requires ${name}: ${ranges[name]}`]
        : [],
    );

    if (failures.length) {
      item.status = 'error';
      item.message += `; ${failures.join('; ')}`;
    }
  }

  const matches = (row: (typeof TESTED_MATRIX)[number]): number =>
    Number(versions.react === row.react && versions['react-dom'] === row.react) +
    Number(versions['react-router'] === row.router) +
    Number(versions.vite === row.vite);
  const distance = (installed: string | null, tested: string): number => {
    const version = semver.parse(installed);
    const target = semver.parse(tested)!;

    return version
      ? Math.abs(version.major - target.major) * 1_000_000 +
          Math.abs(version.minor - target.minor) * 1_000 +
          Math.abs(version.patch - target.patch)
      : Number.MAX_SAFE_INTEGER;
  };
  // Prefer the most matching components, then nearest React, Router, and Vite versions.
  const [closest] = [...TESTED_MATRIX].sort(
    (left, right) =>
      matches(right) - matches(left) ||
      distance(versions.react, left.react) - distance(versions.react, right.react) ||
      distance(versions['react-dom'], left.react) - distance(versions['react-dom'], right.react) ||
      distance(versions['react-router'], left.router) -
        distance(versions['react-router'], right.router) ||
      distance(versions.vite, left.vite) - distance(versions.vite, right.vite),
  );
  const trio = `React ${versions.react ?? 'missing'}${versions['react-dom'] !== versions.react ? ` (React DOM ${versions['react-dom'] ?? 'missing'})` : ''} + Router ${versions['react-router'] ?? 'missing'} + Vite ${versions.vite ?? 'missing'}`;
  const isTested = matches(closest) === 3;

  checks.push({
    name: 'compatibility',
    status: isTested ? 'ok' : 'warn',
    message: isTested
      ? `${trio} is a tested row`
      : `${trio} is not a tested row; closest: React ${closest.react} + Router ${closest.router} + Vite ${closest.vite}`,
    fix: `Use React and React DOM ${closest.react}, React Router ${closest.router}, and Vite ${closest.vite} for a tested combination.`,
  });

  check(
    'node',
    'Use a Node version satisfying the package and app engines (CI uses 22.23.2).',
    () => {
      if (pkg.engines?.node) {
        engines.app = pkg.engines.node;
      }

      const failures = Object.entries(engines).filter(
        ([, range]) => !semver.satisfies(process.versions.node, range),
      );

      if (failures.length) {
        throw new Error(
          `Node ${process.versions.node} does not satisfy ${failures.map(([name, range]) => `${name}: ${range}`).join(', ')}`,
        );
      }

      return `Node ${process.versions.node} satisfies engines`;
    },
  );

  check('react-copies', 'Run npm dedupe and align React/React DOM dependency versions.', () => {
    const copies = reactCopies(root);

    if (copies.react !== 1 || copies['react-dom'] !== 1) {
      throw new Error(`React copies: ${copies.react}; React DOM copies: ${copies['react-dom']}`);
    }

    return 'One physical copy each of React and React DOM';
  });

  let config: TProjectConfig | undefined;

  check('vite-plugin', 'Add SsrBoost() from @lomray/vite-ssr-boost/plugin to Vite plugins.', () => {
    config = readConfig(root);

    if (!config.plugin) {
      throw new Error('Vite plugins do not contain the imported SsrBoost() plugin');
    }

    return 'SsrBoost() is in the Vite plugins';
  });

  const viteRoot =
    config?.viteRoot ??
    (fs.existsSync(path.join(root, 'index.html')) ? root : path.join(root, 'src'));
  const indexFile = path.resolve(
    viteRoot,
    stringValue(config?.option('indexFile')) ?? 'index.html',
  );
  const clientFile = stringValue(config?.option('clientFile')) ?? 'client.ts';
  const serverFile = stringValue(config?.option('serverFile')) ?? 'server.ts';

  check(
    'html-module',
    'Keep one local <script type="module" src="..."> pointing to the configured clientFile.',
    () => {
      const html = readHtml(indexFile);

      if (html.entries.length !== 1) {
        throw new Error(
          `${path.relative(root, indexFile)}: expected one module script, found ${html.entries.length}`,
        );
      }

      const src = html.attribute(html.entries[0], 'src');

      if (
        !src ||
        /^(?:\w+:|\/\/)/.test(src) ||
        path.resolve(
          src.startsWith('/') ? viteRoot : path.dirname(indexFile),
          src.replace(/^\//, ''),
        ) !== path.resolve(viteRoot, clientFile)
      ) {
        throw new Error(
          `${path.relative(root, indexFile)}: module script does not match clientFile`,
        );
      }

      return 'Module script matches the browser entry';
    },
  );

  check('html-outlet', 'Place exactly one <!--ssr-outlet--> inside the root element.', () => {
    const html = readHtml(indexFile);

    if (html.outlets !== 1) {
      throw new Error(
        `${path.relative(root, indexFile)}: expected one <!--ssr-outlet-->, found ${html.outlets}`,
      );
    }

    return 'Exactly one SSR outlet';
  });

  const sources = new SourceFiles(config?.aliases);

  for (const [kind, file, expected] of [
    ['browser', clientFile, 'browser/entry'],
    ['server', serverFile, 'adapters/express/entry'],
  ]) {
    check(
      `${kind}-entry`,
      `Create the ${kind} entry and import ${PLUGIN_NAME}/${expected}.`,
      () => {
        const imports = sources
          .read(path.resolve(viteRoot, file))
          .ast.program.body.filter((node) => node.type === 'ImportDeclaration');

        if (
          !imports.some(
            (node) => node.source.value.replace(/\.js$/, '') === `${PLUGIN_NAME}/${expected}`,
          )
        ) {
          throw new Error(`${file}: missing library ${expected} import`);
        }

        if (kind === 'server') {
          report.adapter = 'express';
        }

        return `${file} imports ${expected}`;
      },
    );
  }

  check(
    'routes',
    'Use statically analyzable route objects; follow the file and line in the parser error.',
    () => {
      report.routes = routeDetails(
        new ParseRoutes(
          ServerConfig.init({}, { root: viteRoot, clientFile }),
          config?.aliases,
        ).parse(true),
      );

      return `${report.routes.length} route IDs resolved`;
    },
  );

  check(
    'scripts',
    'Set dev (or develop)="ssr-boost dev", build="ssr-boost build", start:ssr="ssr-boost start".',
    () => {
      const scripts = pkg.scripts ?? {};
      const missing = [
        ['dev', scripts.dev ?? scripts.develop],
        ['build', scripts.build],
        ['start', scripts['start:ssr'] ?? scripts.start],
      ].filter(
        ([command, value]) =>
          !new RegExp(`(?:^|\\s)ssr-boost\\s+${command}(?:\\s|$)`).test(value ?? ''),
      );

      if (missing.length) {
        throw new Error(
          `Scripts missing ssr-boost commands: ${missing.map(([command]) => command).join(', ')}`,
        );
      }

      return 'Development, build, and SSR start scripts use ssr-boost';
    },
  );

  check(
    'robots',
    'Review public/robots.txt for your deployment; use build --unlock-robots only when intended.',
    () => {
      const publicDir =
        stringValue(config ? objectProperty(config.node, 'publicDir') : undefined) ?? 'public';
      const file = path.resolve(viteRoot, publicDir, 'robots.txt');

      if (!fs.existsSync(file)) {
        return 'No robots.txt policy (report only)';
      }

      return /^Disallow:\s*\/\s*$/im.test(fs.readFileSync(file, 'utf8'))
        ? 'robots.txt blocks crawling at / (report only)'
        : 'robots.txt contains a custom/allow policy (report only)';
    },
    true,
  );

  check(
    'size-budget',
    'Add a size:check or test:size script with an application bundle budget.',
    () =>
      Object.keys(pkg.scripts ?? {}).some((name) => /(?:^|:)size(?::|$)/.test(name))
        ? 'Size budget script present'
        : 'No size budget script (informational)',
    true,
  );

  const build = config ? objectProperty(config.node, 'build') : undefined;
  const outDir =
    build?.type === 'ObjectExpression' ? stringValue(objectProperty(build, 'outDir')) : undefined;
  const diagnosticsFile = path.resolve(viteRoot, outDir ?? 'dist', 'ssr-boost-diagnostics.json');

  if (fs.existsSync(diagnosticsFile)) {
    try {
      const recorded: unknown = JSON.parse(fs.readFileSync(diagnosticsFile, 'utf8'));
      const codes: unknown =
        recorded && typeof recorded === 'object' ? Reflect.get(recorded, 'codes') : undefined;

      report.diagnosticCodes = Array.isArray(codes)
        ? DIAGNOSTIC_CODES.filter((code) => codes.includes(code))
        : [];
    } catch {
      // A stale or unrelated file is not evidence of diagnostic codes.
    }
  }

  return report;
};

/** Support bundles contain an allowlist, never raw messages, npm output, env, or source. */
export const supportBundle = (report: IDoctorReport) => ({
  schemaVersion: 1,
  versions: report.versions,
  adapter: report.adapter,
  routes: report.routes,
  checks: report.checks.map(({ name, status, fix, info }) => ({
    name,
    status,
    fix,
    ...(info ? { info } : {}),
  })),
  diagnosticCodes: report.diagnosticCodes,
});

const runDoctor = (options: IDoctorOptions = {}): void => {
  const report = inspectProject(options);

  if (options.bundle) {
    try {
      fs.writeFileSync(
        path.resolve(options.root ?? process.cwd(), options.bundle),
        `${JSON.stringify(supportBundle(report), null, 2)}\n`,
      );
    } catch {
      report.checks.push({
        name: 'bundle',
        status: 'error',
        message: 'Cannot write the support bundle.',
        fix: 'Choose a writable file in an existing directory for --bundle.',
      });
    }
  }

  if (options.json) {
    console.info(JSON.stringify(report, null, 2));
  } else {
    console.table(
      report.checks.map(({ status, name, message, fix }) => ({
        status,
        check: name,
        message,
        fix,
      })),
    );
  }

  process.exitCode = report.checks.some((check) => check.status === 'error') ? 1 : 0;
};

export default runDoctor;
