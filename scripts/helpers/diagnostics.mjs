const diagnosticCode = /\b(SSR_BOOST_[A-Z_]+)(?=:|\])/g;

/**
 * Classify every SSR_BOOST_ code in one process's output: policy lines are informational,
 * an Express hook deprecation is expected once per distinct line, and the rest are unexpected.
 */
const countDiagnostics = (output) => {
  const counts = { policyInfo: 0, expressHookDeprecations: 0, unexpected: 0, repeated: [] };
  const deprecations = new Set();

  for (const line of output.split('\n')) {
    for (const match of line.matchAll(diagnosticCode)) {
      const [marker, code] = match;

      if (code === 'SSR_BOOST_SSR_POLICY') {
        counts.policyInfo += 1;
      } else if (code === 'SSR_BOOST_DEPRECATED_EXPRESS_HOOK') {
        const detail = line.slice(match.index + marker.length);

        if (deprecations.has(detail)) counts.repeated.push(detail);
        deprecations.add(detail);
        counts.expressHookDeprecations += 1;
      } else {
        counts.unexpected += 1;
      }
    }
  }

  return counts;
};

export default countDiagnostics;
