/**
 * Detect route file
 */
const isRoutesFile = (code: string): boolean => /\[.*{.*path:.*lazy:.+import/s.test(code);

export default isRoutesFile;
