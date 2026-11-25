import { execFileSync } from 'node:child_process';

/**
 * Advisories that are tolerated only inside the npm CLI bundled with @semantic-release/npm.
 * Bundled dependencies cannot be overridden, and these stay until npm ships patched copies.
 * Every other advisory, at any severity and in any other path, fails the check.
 */
const allowed = [
  {
    id: 'GHSA-3g3m-2fjr-6pw4',
    path: 'node_modules/npm/',
    reason: 'glob bundled in npm 11/12, release tooling only',
  },
  {
    id: 'GHSA-g3hv-75wg-m249',
    path: 'node_modules/npm/',
    reason: 'minimatch bundled in npm 11/12, release tooling only',
  },
];

const read = () => {
  try {
    return execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the report is still on stdout.
    if (error.stdout) {
      return error.stdout;
    }

    throw error;
  }
};

const report = JSON.parse(read());

if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(1);
}

const advisoryId = (url) => url?.split('/').pop();
const failures = [];
const used = new Set();

for (const entry of Object.values(report.vulnerabilities ?? {})) {
  for (const via of entry.via) {
    if (typeof via !== 'object') {
      continue;
    }

    const id = advisoryId(via.url);
    const rule = allowed.find((item) => item.id === id);
    const outside = entry.nodes.filter((node) => !rule || !node.startsWith(rule.path));

    if (outside.length > 0) {
      failures.push(`${entry.name} ${via.range} ${via.severity} ${via.url} (${outside.join(', ')})`);
    } else {
      used.add(id);
    }
  }
}

for (const rule of allowed) {
  if (used.has(rule.id)) {
    console.warn(`allowed: ${rule.id} in ${rule.path}* (${rule.reason})`);
  } else {
    console.warn(`stale allowance: ${rule.id} no longer reported, remove it from scripts/audit.mjs`);
  }
}

if (failures.length > 0) {
  console.error(`${failures.length} advisory finding(s):\n${failures.join('\n')}`);
  process.exit(1);
}

console.log('npm audit: no findings outside the allowed npm bundle advisories');
