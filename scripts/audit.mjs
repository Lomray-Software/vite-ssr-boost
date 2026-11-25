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
    // npm audit exits non-zero when it finds anything; the report is still on stdout.
    if (error.stdout) {
      return error.stdout;
    }

    throw error;
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

const entries = Object.values(report.vulnerabilities);
const total = Number(report.metadata.vulnerabilities.total ?? 0);

if (total !== entries.length) {
  fail(`npm audit report is inconsistent: metadata total ${total}, ${entries.length} entries`);
}

const advisoryId = (url) => (typeof url === 'string' ? url.split('/').pop() : undefined);
const failures = [];
const used = new Set();

for (const entry of entries) {
  const nodes = Array.isArray(entry.nodes) ? entry.nodes : [];
  const via = Array.isArray(entry.via) ? entry.via : [];

  if (nodes.length === 0 || via.length === 0) {
    failures.push(`${entry.name ?? 'unknown package'}: advisory without install paths or source`);

    continue;
  }

  for (const source of via) {
    if (typeof source === 'string') {
      // A transitive entry: it is covered by the package it points to, which must be in the report.
      if (!isObject(report.vulnerabilities[source])) {
        failures.push(`${entry.name}: points to ${source}, which is not in the report`);
      }

      continue;
    }

    if (!isObject(source)) {
      failures.push(`${entry.name}: unreadable advisory source`);

      continue;
    }

    const id = advisoryId(source.url);
    const rule = allowed.find((item) => item.id === id && item.name === entry.name);
    const outside = nodes.filter((node) => !rule || !node.startsWith(`${rule.path}${rule.name}`));

    if (outside.length > 0) {
      failures.push(
        `${entry.name} ${source.range} ${source.severity} ${source.url} (${outside.join(', ')})`,
      );
    } else {
      used.add(id);
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
