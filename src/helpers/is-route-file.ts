/**
 * Detect route file
 */
const isRoutesFile = (code: string): boolean =>
  /(?:\blazy|['"]lazy['"]\s*\]?)\s*:\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/s.test(code) ||
  /{.*(?:path|index)\s*:.*(?:Component|element)\s*:|{.*(?:Component|element)\s*:.*(?:path|index)\s*:/s.test(
    code,
  );

export default isRoutesFile;
