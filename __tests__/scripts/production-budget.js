// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertProductionBudgets } from '../../scripts/helpers/production-budget.mjs';

const MIB = 1024 ** 2;

/**
 * Isolate the retained-heap budget from the startup and initial RSS gates.
 */
const measurements = (growth) => ({
  coldStart: { baselineMs: 100, candidateMs: 150 },
  baselineRss: 100 * MIB,
  candidateRss: 120 * MIB,
  baselineRetained: 10 * MIB,
  baselineLoadRetained: 11 * MIB,
  candidateRetained: 20 * MIB,
  candidateLoadRetained: 20 * MIB + growth,
});

describe('production retained heap budget', () => {
  /**
   * Accept the exact allowance and reject even a one-byte excess.
   */
  it('compares retained deltas without rounding', () => {
    expect(() => assertProductionBudgets(measurements(9 * MIB))).not.toThrow();
    expect(() => assertProductionBudgets(measurements(9 * MIB + 1))).toThrow(
      /retained heap growth after 10,000 additional requests/,
    );
  });

  /**
   * Require both retained samples before accepting a run.
   */
  it('rejects missing retained samples', () => {
    expect(() => assertProductionBudgets({ ...measurements(0), baselineLoadRetained: undefined })).toThrow();
    expect(() => assertProductionBudgets({ ...measurements(0), candidateRetained: undefined })).toThrow();
  });
});
