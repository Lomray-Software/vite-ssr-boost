import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluate } from './audit.mjs';

const counts = (overrides = {}) => ({
  info: 0,
  low: 0,
  moderate: 0,
  high: 0,
  critical: 0,
  total: 0,
  ...overrides,
});

const report = (vulnerabilities = {}, vulnerabilityCounts = counts(), extra = {}) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: { vulnerabilities: vulnerabilityCounts },
  ...extra,
});

const run = (status, body) => ({
  status,
  stdout: typeof body === 'string' ? body : JSON.stringify(body),
});

const bundledMinimatch = {
  minimatch: {
    name: 'minimatch',
    severity: 'moderate',
    via: [
      {
        source: 1,
        name: 'minimatch',
        url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
        severity: 'moderate',
        range: '>=7.0.0 <11.0.1',
      },
    ],
    nodes: ['node_modules/npm/node_modules/minimatch'],
  },
};

const rootMinimatch = {
  minimatch: {
    ...bundledMinimatch.minimatch,
    nodes: ['node_modules/minimatch'],
  },
};

const firstError = (input) => evaluate(input).errors[0] ?? '';

describe('audit gate', () => {
  it('passes a clean run', () => {
    assert.deepEqual(evaluate(run(0, report())).errors, []);
  });

  it('passes an advisory that sits only in the npm bundle', () => {
    const result = evaluate(run(1, report(bundledMinimatch, counts({ moderate: 1, total: 1 }))));

    assert.deepEqual(result.errors, []);
    assert.ok(result.notes.some((line) => line.startsWith('allowed: GHSA-g3hv-75wg-m249')));
  });

  it('fails the same advisory outside the npm bundle', () => {
    const result = evaluate(run(1, report(rootMinimatch, counts({ moderate: 1, total: 1 }))));

    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /node_modules\/minimatch/);
  });

  it('fails exit status 1 with an empty report', () => {
    assert.deepEqual(evaluate(run(1, report())).errors, [
      'npm audit exited with status 1 but reported no findings',
    ]);
  });

  it('fails an unexpected exit status', () => {
    assert.match(firstError(run(2, report())), /unexpected status 2/);
  });

  it('fails severity counts that do not add up to the total', () => {
    assert.match(
      firstError(run(1, report(bundledMinimatch, counts({ high: 1, total: 2 })))),
      /inconsistent/,
    );
  });

  it('fails a total that does not match the entries', () => {
    assert.match(firstError(run(0, report({}, counts({ low: 1, total: 1 })))), /inconsistent/);
  });

  it('fails missing or invalid severity counts', () => {
    const { critical: _, ...withoutCritical } = counts();

    assert.match(firstError(run(0, report({}, withoutCritical))), /severity counts/);
    assert.match(firstError(run(0, report({}, counts({ low: -1, total: -1 })))), /severity counts/);
  });

  it('fails an unknown report version', () => {
    assert.match(
      firstError(run(0, report({}, counts(), { auditReportVersion: 1 }))),
      /version 1 is not supported/,
    );
    assert.match(
      firstError(run(0, report({}, counts(), { auditReportVersion: undefined }))),
      /not supported/,
    );
  });

  it('fails an unreadable or error report', () => {
    assert.match(firstError(run(1, 'not json')), /unreadable/);
    assert.match(firstError(run(1, { error: { summary: 'network down' } })), /network down/);
  });

  it('fails a transitive entry that leads nowhere', () => {
    const dangling = {
      ...bundledMinimatch,
      npm: { name: 'npm', severity: 'moderate', via: ['glob'], nodes: ['node_modules/npm'] },
    };

    assert.deepEqual(evaluate(run(1, report(dangling, counts({ moderate: 2, total: 2 })))).errors, [
      'npm: points to glob, which does not lead to an advisory',
    ]);
  });
});
