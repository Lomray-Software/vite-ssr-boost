/**
 * Detect route file
 */
const isRoutesFile = (code: string): boolean =>
  /{.*path:.*(lazy:.+import|Component:|element:)|{.*(lazy:.+import|Component:|element:).*path:/s.test(
    code,
  );

export default isRoutesFile;
