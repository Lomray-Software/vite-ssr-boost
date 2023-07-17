/**
 * Detect route file
 */
const isRoutesFile = (code: string): boolean => /\[.*{.*path:.*lazyNR:.+import/s.test(code);

export default isRoutesFile;
