import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Advisories that are tolerated only inside the npm CLI bundled with @semantic-release/npm.
 * Bundled dependencies cannot be overridden, and these stay until npm ships patched copies.
 * Every other advisory, at any severity, in any other package or path, fails the check.
 */
export const allowed = [
  {
    id: 'GHSA-3g3m-2fjr-6pw4',
    name: 'glob',
    path: 'node_modules/npm/node_modules/',
    reason: 'glob bundled in npm 11/12, release tooling only',
  },
  {
    id: 'GHSA-g3hv-75wg-m249',
    name: 'minimatch',
    path: 'node_modules/npm/node_modules/',
    reason: 'minimatch bundled in npm 11/12, release tooling only',
  },
];

/**
 * The advisory source the gate trusts. A registry from an .npmrc file or the environment
 * could answer with an incomplete advisory set, so it is pinned on the command line.
 */
export const registry = 'https://registry.npmjs.org/';

/**
 * Command line flags win over every .npmrc file and the environment, so the audit always covers
 * every dependency type (prod, dev, optional and peer) whatever the local configuration omits.
 */
export const auditArgs = (registryUrl = registry) => [
  'audit',
  '--json',
  '--include=prod',
  '--include=dev',
  '--include=optional',
  '--include=peer',
  `--registry=${registryUrl}`,
];

/**
 * Settings inherited from the environment that would narrow the audit or redirect it.
 * The flags above already win over them; they are dropped as well, so the child sees no conflict.
 */
const narrowing =
  /^npm_config_(omit|only|production|include|optional|dev|also|workspaces?|include_workspace_root|registry|userconfig|globalconfig)$/i;

const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const advisoryUrl = 'https://github.com/advisories/';
const root = fileURLToPath(new URL('..', import.meta.url));

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * Run npm audit and keep its exit status next to its output.
 * The npm that runs the gate (npm_execpath, set by `npm run`) runs the audit, never an npm
 * installed as a dependency in node_modules/.bin. npm exits with 0 when it finds nothing and
 * 1 when it finds something; the report is on stdout in both cases. Any other outcome (a spawn
 * or buffer error, a signal, another status) is returned as an error: the audit did not complete.
 */
export const runAudit = ({
  cwd = root,
  env = process.env,
  npm = env.npm_execpath,
  registry: registryUrl = registry,
} = {}) => {
  if (!npm) {
    return { error: 'npm_execpath is not set: run the gate with "npm run audit:check"' };
  }

  const result = spawnSync(process.execPath, [npm, ...auditArgs(registryUrl)], {
    cwd,
    encoding: 'utf8',
    env: Object.fromEntries(Object.entries(env).filter(([key]) => !narrowing.test(key))),
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    return { error: `npm audit did not complete: ${result.error.message}` };
  }

  if (result.signal) {
    return { error: `npm audit was terminated by ${result.signal}` };
  }

  if (result.status !== 0 && result.status !== 1) {
    return { error: `npm audit exited with status ${result.status}: ${result.stderr.trim()}` };
  }

  return { status: result.status, stdout: result.stdout };
};

/**
 * Check one npm audit run against the allowlist.
 * Returns the findings that fail the gate (`errors`) and informational lines (`notes`).
 * A report that cannot be fully accounted for always fails: the gate never passes on doubt.
 */
export const evaluate = ({ status, stdout }) => {
  const errors = [];
  const notes = [];
  const result = () => ({ errors, notes });
  const stop = (message) => {
    errors.push(message);

    return result();
  };

  if (status !== 0 && status !== 1) {
    return stop(`npm audit exited with unexpected status ${status}`);
  }

  let report;

  try {
    report = JSON.parse(stdout);
  } catch (error) {
    return stop(`npm audit returned an unreadable report: ${error.message}`);
  }

  if (!isObject(report)) {
    return stop('npm audit returned an unexpected report shape');
  }

  if (Object.hasOwn(report, 'error')) {
    return stop(`npm audit failed: ${report.error?.summary ?? JSON.stringify(report.error)}`);
  }

  // Only the npm 7+ report format is understood; any other shape is not trusted.
  if (report.auditReportVersion !== 2) {
    return stop(`npm audit report version ${report.auditReportVersion} is not supported`);
  }

  // Never pass on a report we cannot read: a missing section means the audit did not run as expected.
  if (!isObject(report.vulnerabilities) || !isObject(report.metadata?.vulnerabilities)) {
    return stop('npm audit report is missing "vulnerabilities" or "metadata.vulnerabilities"');
  }

  const { vulnerabilities } = report;
  const counts = report.metadata.vulnerabilities;
  const entries = Object.entries(vulnerabilities);

  if (!isCount(counts.total) || severities.some((level) => !isCount(counts[level]))) {
    return stop('npm audit report has missing or invalid severity counts');
  }

  const sum = severities.reduce((acc, level) => acc + counts[level], 0);

  if (sum !== counts.total || counts.total !== entries.length) {
    return stop(
      `npm audit report is inconsistent: severities sum to ${sum}, metadata total ${counts.total}, ${entries.length} entries`,
    );
  }

  // npm signals findings with status 1; a failing run that lists nothing is not a clean run.
  if (status === 1 && entries.length === 0) {
    return stop('npm audit exited with status 1 but reported no findings');
  }

  const used = new Set();
  const has = (name) => Object.hasOwn(vulnerabilities, name) && isObject(vulnerabilities[name]);

  /**
   * A transitive entry only points at other entries. npm reports can hold cycles between
   * dependents (semantic-release and @semantic-release/github), so a reference is valid when
   * at least one chain from it reaches a direct advisory object. A dangling reference, or a
   * cycle that never reaches an advisory, fails.
   */
  const reachesAdvisory = (name, seen = new Set()) => {
    if (!has(name) || seen.has(name)) {
      return false;
    }

    seen.add(name);

    const via = Array.isArray(vulnerabilities[name].via) ? vulnerabilities[name].via : [];

    return via.some((source) =>
      typeof source === 'string' ? reachesAdvisory(source, seen) : isObject(source),
    );
  };

  for (const [key, entry] of entries) {
    if (!isObject(entry) || entry.name !== key) {
      errors.push(`${key}: report entry does not match its package name`);

      continue;
    }

    const nodes = Array.isArray(entry.nodes) ? entry.nodes : [];
    const via = Array.isArray(entry.via) ? entry.via : [];

    if (nodes.length === 0 || via.length === 0) {
      errors.push(`${key}: advisory without install paths or source`);

      continue;
    }

    for (const source of via) {
      if (typeof source === 'string') {
        // A transitive entry: its chain must end in a direct advisory, which the loop checks itself.
        if (!reachesAdvisory(source)) {
          errors.push(`${key}: points to ${source}, which does not lead to an advisory`);
        }

        continue;
      }

      if (!isObject(source)) {
        errors.push(`${entry.name}: unreadable advisory source`);

        continue;
      }

      // An allowance applies only to its own advisory, on its own package, at its exact install path.
      const rule = allowed.find(
        (item) =>
          source.url === `${advisoryUrl}${item.id}` &&
          source.name === item.name &&
          entry.name === item.name,
      );
      const outside = nodes.filter((node) => !rule || node !== `${rule.path}${rule.name}`);

      if (outside.length > 0) {
        errors.push(
          `${entry.name} ${source.range} ${source.severity} ${source.url} (${outside.join(', ')})`,
        );
      } else {
        used.add(rule.id);
      }
    }
  }

  for (const rule of allowed) {
    notes.push(
      used.has(rule.id)
        ? `allowed: ${rule.id} ${rule.name} in ${rule.path} (${rule.reason})`
        : `stale allowance: ${rule.id} no longer reported, remove it from scripts/audit-gate.mjs`,
    );
  }

  return result();
};

/**
 * Audit the checked-in lockfile of this repository and print the outcome.
 * Returns the process exit code: 0 only when every finding is an allowed npm bundle advisory.
 */
export const main = () => {
  if (!existsSync(new URL('../package-lock.json', import.meta.url))) {
    console.error('package-lock.json is missing: the audit needs the checked-in lockfile');

    return 1;
  }

  const run = runAudit();

  if (run.error) {
    console.error(run.error);

    return 1;
  }

  const { errors, notes } = evaluate(run);

  notes.forEach((line) => console.warn(line));

  if (errors.length > 0) {
    console.error(`${errors.length} audit finding(s):\n${errors.join('\n')}`);

    return 1;
  }

  console.log('npm audit: no findings outside the allowed npm bundle advisories');

  return 0;
};
