export interface ISsrExecutionContext<TPlatform = unknown> {
  /** Runtime bindings and the native execution context, supplied by an adapter. */
  platform?: TPlatform;
  /** Extend request lifetime for background work supported by the runtime. */
  waitUntil?: (promise: Promise<unknown>) => void;

  /**
   * Deliver informational headers outside the final Fetch response when supported.
   */
  onEarlyHints?: (headers: Headers) => Promise<void> | void;
}

export type TSsrHandler = (request: Request, context?: ISsrExecutionContext) => Promise<Response>;
