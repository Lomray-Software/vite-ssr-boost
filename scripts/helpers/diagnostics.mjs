import { stripVTControlCharacters } from 'node:util';

const diagnosticCode = /\b(SSR_BOOST_[A-Z0-9_]+)(?=:|\])/g;
// The hook follows the code after either delimiter: `CODE: hook` or `[CODE] hook`.
const hookName = /^[:\]]\s*([\w.]+)/;
// Color codes in either form, `ESC[38;2;255;0;0m` or `ESC[38:2::255:0:0m`: the util helper
// leaves the colon form behind.
const colorCode = /\x1b\[[0-9:;]*m/g;

/**
 * Classify every SSR_BOOST_ code in one process's output: policy lines are informational,
 * an Express hook deprecation is expected once per hook, and the rest are unexpected.
 */
const countDiagnostics = (output) => {
  const counts = { policyInfo: 0, expressHookDeprecations: 0, unexpected: 0, repeated: [] };
  const deprecations = new Set();

  // A color code ends in a word character, which would defeat the boundary before a code.
  for (const line of stripVTControlCharacters(output.replace(colorCode, '')).split('\n')) {
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
