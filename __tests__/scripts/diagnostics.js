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
   * Verify colon-form truecolor codes count the same as plain output.
   */
  it('counts colon-form colored codes like plain ones', () => {
    const red = '\x1b[38:2::255:0:0m';
    const plain = [
      'SSR_BOOST_HTTP2: refused',
      'SSR_BOOST_DEPRECATED_EXPRESS_HOOK: onRequest first',
      'SSR_BOOST_DEPRECATED_EXPRESS_HOOK: onRequest second',
    ];
    const colored = plain.map((line) => line.replace('SSR', `${red}SSR`).replace(': ', `: ${red}`));

    expect(countDiagnostics(colored.join('\n'))).toEqual(countDiagnostics(plain.join('\n')));
    expect(countDiagnostics(colored.join('\n'))).toEqual({
      policyInfo: 0,
      expressHookDeprecations: 2,
      unexpected: 1,
      repeated: ['onRequest'],
    });
  });

  /**
   * Verify C1 control sequences and intermediate bytes are removed like ESC color codes.
   */
  it('counts codes and hooks wrapped in any control sequence like plain ones', () => {
    const plain = [
      'SSR_BOOST_HTTP2: refused',
      'SSR_BOOST_DEPRECATED_EXPRESS_HOOK: onRequest first',
      'SSR_BOOST_DEPRECATED_EXPRESS_HOOK: onRequest second',
    ];
    const wrapped = [
      '\u009b38:2::255:0:0mSSR_BOOST_HTTP2: refused',
      'SSR_BOOST_DEPRECATED_EXPRESS_HOOK: \x1b[2 qonRequest first',
      plain[2],
    ];

    expect(countDiagnostics(wrapped.join('\n'))).toEqual(countDiagnostics(plain.join('\n')));
    expect(countDiagnostics(wrapped.join('\n'))).toEqual({
      policyInfo: 0,
      expressHookDeprecations: 2,
      unexpected: 1,
      repeated: ['onRequest'],
    });
  });

  /**
   * Verify a code inside a control string payload is never counted, in ESC or C1 form.
   */
  it('ignores codes inside control strings', () => {
    const titles = [
      '\x1b]0;[SSR_BOOST_OTHER]\x07ready',
      '\x1b]0;SSR_BOOST_OTHER: title\x1b\\ready',
      '\u009d0;[SSR_BOOST_OTHER]\u009cready',
      `\x1b]8;;https://example.com\x07${policy}\x1b]8;;\x07`,
    ];

    expect(countDiagnostics(titles.join('\n'))).toEqual({
      policyInfo: 1,
      expressHookDeprecations: 0,
      unexpected: 0,
      repeated: [],
    });
  });

  /**
   * Verify an unterminated control string prints nothing, and a cancelled one resumes the text.
   */
  it('drops an unterminated control string and resumes text after a cancel', () => {
    expect(countDiagnostics('ready\n\x1b]0;[SSR_BOOST_OTHER]')).toMatchObject({ unexpected: 0 });
    expect(countDiagnostics('\u009d0;SSR_BOOST_OTHER: title')).toMatchObject({ unexpected: 0 });

    const cancelled = [
      '\x1b]0;title\x18[SSR_BOOST_OTHER] text\x07',
      '\x1bPq\x1a' + policy,
      `${hook}\x1b]0;x\x18`,
      hook,
    ];

    expect(countDiagnostics(cancelled.join('\n'))).toEqual({
      policyInfo: 1,
      expressHookDeprecations: 2,
      unexpected: 1,
      repeated: ['onRequest'],
    });
  });

  /**
   * Verify a C0 byte a terminal ignores inside a control sequence leaves the sequence whole.
   */
  it('keeps a control sequence whole around an ignored byte', () => {
    const wrapped = [
      '\x1b[3\x001mSSR_BOOST_HTTP2: refused',
      'SSR_BOOST_DEPRECATED_EXPRESS_HOOK: \x1b[3\x001monRequest first',
      'SSR_BOOST_DEPRECATED_EXPRESS_HOOK: onRequest second',
    ];

    expect(countDiagnostics(wrapped.join('\n'))).toEqual({
      policyInfo: 0,
      expressHookDeprecations: 2,
      unexpected: 1,
      repeated: ['onRequest'],
    });
  });

  /**
   * Verify a control that moves the cursor separates the text on each side like a line break.
   */
  it('splits text at every cursor move', () => {
    const moves = [
      '\x0b',
      '\x0c',
      '\x08',
      '\u0084',
      '\u0085',
      '\u008d',
      '\x1bD',
      '\x1bE',
      '\x1bM',
      '\x1b8',
      '\x1bc',
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'Z', '`', 'a', 'd', 'e', 'u'].map(
        (final) => `\x1b[2${final}`,
      ),
      '\x1b[2;1H',
      '\u009b3;1f',
    ];
    const lines = moves.map((move) => `ready${move}SSR_BOOST_OTHER: refused`);

    expect(countDiagnostics(lines.join('\n'))).toMatchObject({ unexpected: moves.length });
    expect(
      countDiagnostics(
        'SSR_BOOST_DEPRECATED_EXPRESS_HOOK: onRequest first\u0085' +
          'SSR_BOOST_DEPRECATED_EXPRESS_HOOK: onRequest second',
      ),
    ).toMatchObject({ expressHookDeprecations: 2, repeated: ['onRequest'] });
  });

  /**
   * Verify a control that keeps the cursor in place, or a private sequence, joins the text.
   */
  it('keeps text joined around controls that do not move the cursor', () => {
    const joined = ['\x1b[1m', '\x1b[2K', '\x1b[?25h', '\x1b[ A', '\x1b#8', '\x07'];
    const lines = joined.map((control) => `ready${control}SSR_BOOST_OTHER: refused`);

    expect(countDiagnostics(lines.join('\n'))).toMatchObject({ unexpected: 0 });
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
