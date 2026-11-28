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
   * Verify a code holding a digit is counted, not skipped.
   */
  it('counts a code with a digit', () => {
    expect(countDiagnostics(`${policy} SSR_BOOST_HTTP2: refused`)).toMatchObject({
      policyInfo: 1,
      unexpected: 1,
    });
  });

  /**
   * Verify a repeat in the bracket form is keyed by its hook, so trailing text cannot hide it.
   */
  it('reports a bracket-form repeat followed by other text', () => {
    const bracket = '[SSR_BOOST_DEPRECATED_EXPRESS_HOOK] onRequest(req, res) receives Express.';
    const counts = countDiagnostics([bracket, `${bracket} ${policy}`].join('\n'));

    expect(counts).toEqual({
      policyInfo: 1,
      expressHookDeprecations: 2,
      unexpected: 0,
      repeated: ['onRequest'],
    });
  });

  /**
   * Verify terminal colors around a code or a hook neither hide the code nor the repeat.
   */
  it('counts colored codes and keys a colored hook', () => {
    const colored = '\x1b[33m[SSR_BOOST_DEPRECATED_EXPRESS_HOOK]\x1b[0m \x1b[1monRequest\x1b[22m';
    const counts = countDiagnostics(
      [
        `\x1b[33mSSR_BOOST_HTTP2: refused\x1b[0m`,
        `${colored} first`,
        `${colored} second`,
      ].join('\n'),
    );

    expect(counts).toEqual({
      policyInfo: 0,
      expressHookDeprecations: 2,
      unexpected: 1,
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
