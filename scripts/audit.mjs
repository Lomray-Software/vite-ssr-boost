import { execFileSync } from 'node:child_process';

/**
 * Advisories that are tolerated only inside the npm CLI bundled with @semantic-release/npm.
 * Bundled dependencies cannot be overridden, and these stay until npm ships patched copies.
 * Every other advisory, at any severity, in any other package or path, fails the check.
 */
const allowed = [
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

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const read = () => {
  try {
    return execFileSync('npm', ['audit', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm audit exits with status 1 when it finds anything; the report is still on stdout.
    // Any other failure (a signal, a crash, a spawn error) means the audit did not complete.
    if (error.status === 1 && !error.signal && typeof error.stdout === 'string') {
      return error.stdout;
    }

    fail(`npm audit did not complete: ${error.message}`);
  }
};

let report;

try {
  report = JSON.parse(read());
} catch (error) {
  fail(`npm audit returned an unreadable report: ${error.message}`);
}

if (!isObject(report)) {
  fail('npm audit returned an unexpected report shape');
}

if (report.error) {
  fail(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
}

// Never pass on a report we cannot read: a missing section means the audit did not run as expected.
if (!isObject(report.vulnerabilities) || !isObject(report.metadata?.vulnerabilities)) {
  fail('npm audit report is missing "vulnerabilities" or "metadata.vulnerabilities"');
}

const vulnerabilities = report.vulnerabilities;
const entries = Object.entries(vulnerabilities);
const { total } = report.metadata.vulnerabilities;

if (!Number.isSafeInteger(total) || total !== entries.length) {
  fail(`npm audit report is inconsistent: metadata total ${total}, ${entries.length} entries`);
}

const advisoryUrl = 'https://github.com/advisories/';
const failures = [];
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
    failures.push(`${key}: report entry does not match its package name`);

    continue;
  }

  const nodes = Array.isArray(entry.nodes) ? entry.nodes : [];
  const via = Array.isArray(entry.via) ? entry.via : [];

  if (nodes.length === 0 || via.length === 0) {
    failures.push(`${key}: advisory without install paths or source`);

    continue;
  }

  for (const source of via) {
    if (typeof source === 'string') {
      // A transitive entry: its chain must end in a direct advisory, which the loop checks itself.
      if (!reachesAdvisory(source)) {
        failures.push(`${key}: points to ${source}, which does not lead to an advisory`);
      }

      continue;
    }

    if (!isObject(source)) {
      failures.push(`${entry.name}: unreadable advisory source`);

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
      failures.push(
        `${entry.name} ${source.range} ${source.severity} ${source.url} (${outside.join(', ')})`,
      );
    } else {
      used.add(rule.id);
    }
  }
}

for (const rule of allowed) {
  if (used.has(rule.id)) {
    console.warn(`allowed: ${rule.id} ${rule.name} in ${rule.path} (${rule.reason})`);
  } else {
    console.warn(
      `stale allowance: ${rule.id} no longer reported, remove it from scripts/audit.mjs`,
    );
  }
}

if (failures.length > 0) {
  fail(`${failures.length} advisory finding(s):\n${failures.join('\n')}`);
}

console.log('npm audit: no findings outside the allowed npm bundle advisories');
