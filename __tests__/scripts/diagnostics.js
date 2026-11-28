// @vitest-environment node
import { describe, expect, it } from 'vitest';
import countDiagnostics from '../../scripts/helpers/diagnostics.mjs';

const hook = '[ssr-boost] SSR_BOOST_DEPRECATED_EXPRESS_HOOK: onRequest(req, res) receives Express.';
const created = '[ssr-boost] SSR_BOOST_DEPRECATED_EXPRESS_HOOK: onServerCreated exposes the app.';
const policy = '[ssr-boost] SSR_BOOST_SSR_POLICY: Pattern "/" selects ssr via config.';

describe('template diagnostics count', () => {
  /**
   * Verify each category is counted from separate lines.
   */
  it('separates policy, express hook and unexpected codes', () => {
    const counts = countDiagnostics(
      [hook, created, policy, '[SSR_BOOST_OTHER] text', ''].join('\n'),
    );

    expect(counts).toEqual({
      policyInfo: 1,
      expressHookDeprecations: 2,
      unexpected: 1,
      repeated: [],
    });
  });

  /**
   * Verify a second code on a line that already holds one is still counted.
   */
  it('counts every code on one line', () => {
    expect(countDiagnostics(`${policy} [SSR_BOOST_UNEXPECTED]`)).toMatchObject({
      policyInfo: 1,
      unexpected: 1,
    });
    expect(countDiagnostics(`${hook} SSR_BOOST_SLOW_RENDER: 900 ms`)).toMatchObject({
      expressHookDeprecations: 1,
      unexpected: 1,
    });
  });

  /**
   * Verify the same deprecation printed twice by one process is reported.
   */
  it('reports a repeated express hook deprecation', () => {
    const counts = countDiagnostics([hook, created, hook].join('\n'));

    expect(counts.expressHookDeprecations).toBe(3);
    expect(counts.repeated).toEqual(['onRequest']);
  });

  /**
   * Verify text after a repeated deprecation on the same line does not hide the repeat.
   */
  it('reports a repeat followed by another code on its line', () => {
    const counts = countDiagnostics([hook, `${hook} ${policy}`].join('\n'));

    expect(counts).toEqual({
      policyInfo: 1,
      expressHookDeprecations: 2,
      unexpected: 0,
      repeated: ['onRequest'],
    });
  });

  /**
   * Verify output without codes counts nothing.
   */
  it('counts nothing in plain output', () => {
    expect(countDiagnostics('Server listening on port 3000\n')).toEqual({
      policyInfo: 0,
      expressHookDeprecations: 0,
      unexpected: 0,
      repeated: [],
    });
  });
});
