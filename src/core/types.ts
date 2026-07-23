export interface ISsrExecutionContext {
  onEarlyHints?: (headers: Headers) => Promise<void> | void;
}

export type TSsrHandler = (request: Request, context?: ISsrExecutionContext) => Promise<Response>;
