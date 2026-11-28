const diagnosticCode = /\b(SSR_BOOST_[A-Z0-9_]+)(?=:|\])/g;
// The hook follows the code after either delimiter: `CODE: hook` or `[CODE] hook`.
const hookName = /^[:\]]\s*([\w.]+)/;
// ECMA-48 control strings (OSC, DCS, SOS, PM, APC) in ESC or C1 form, through BEL or ST. Their
// payload never reaches the screen as text. An unterminated one is left for the rules below.
const controlString = /(?:\x1b[\]PX^_]|[\x90\x98\x9d\x9e\x9f])[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)/g;
// Control sequences in ESC or C1 form: parameters (colon form included), intermediates, final.
const controlSequence = /(?:\x1b\[|\x9b)[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
// Two-character escapes such as a charset switch, `ESC ( B`.
const escapeSequence = /\x1b[\x20-\x2f]*[\x30-\x7e]/g;
// Any other C0 or C1 control; tabs and line ends stay, as a terminal shows them as space.
const control = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

/**
 * Remove every terminal control from output, leaving only the text a terminal would print.
 */
const stripTerminalControls = (output) =>
  output
    .replace(controlString, '')
    .replace(controlSequence, '')
    .replace(escapeSequence, '')
    .replace(control, '');

/**
 * Classify every SSR_BOOST_ code in one process's output: policy lines are informational,
 * an Express hook deprecation is expected once per hook, and the rest are unexpected.
 */
const countDiagnostics = (output) => {
  const counts = { policyInfo: 0, expressHookDeprecations: 0, unexpected: 0, repeated: [] };
  const deprecations = new Set();

  // A control ends in a word character, which would defeat the boundary before a code.
  for (const line of stripTerminalControls(output).split('\n')) {
    for (const match of line.matchAll(diagnosticCode)) {
      const [marker, code] = match;

      if (code === 'SSR_BOOST_SSR_POLICY') {
        counts.policyInfo += 1;
      } else if (code === 'SSR_BOOST_DEPRECATED_EXPRESS_HOOK') {
        const detail = line.slice(match.index + marker.length);
        // Key by the hook, so text printed after the message on the same line cannot hide a repeat.
        const hook = hookName.exec(detail)?.[1] ?? detail;

        if (deprecations.has(hook)) counts.repeated.push(hook);
        deprecations.add(hook);
        counts.expressHookDeprecations += 1;
      } else {
        counts.unexpected += 1;
      }
    }
  }

  return counts;
};

export default countDiagnostics;
