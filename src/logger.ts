/**
 * Production logger: extend it to change the output format and pass the instance as `loggerProd`.
 */
export { default, default as Logger, LogLevels } from '@services/logger';

export type { ILoggerOptions, ILogParams } from '@services/logger';

/**
 * Serialize React Router errors the way the built-in renderer does, without stack traces.
 */
export { default as serializeErrors } from '@helpers/serialize-errors';
