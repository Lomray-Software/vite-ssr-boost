export interface ISsrExecutionContext {
  earlyHints?: (headers: Headers) => Promise<void> | void;
}

export type TSsrHandler = (request: Request, context?: ISsrExecutionContext) => Promise<Response>;
