export interface ISsrExecutionContext {
  /**
   * Deliver informational headers outside the final Fetch response when supported.
   */
  onEarlyHints?: (headers: Headers) => Promise<void> | void;
}

export type TSsrHandler = (request: Request, context?: ISsrExecutionContext) => Promise<Response>;
