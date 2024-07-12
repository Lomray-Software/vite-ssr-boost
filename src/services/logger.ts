import type { LogErrorOptions, Logger as ViteLogger, LogOptions } from 'vite';

const LogLevels = {
  error: 1,
  warn: 2,
  info: 3,
};

interface ILoggerOptions {
  logLevel?: number;
  logFilter?: (params: ILogParams) => boolean;
}

interface ILogParams {
  level: keyof typeof LogLevels;
  msg?: string;
  options?: LogErrorOptions;
}

/**
 * Default production logger
 */
class Logger implements ViteLogger {
  /**
   * @inheritDoc
   */
  public hasWarned: boolean;

  /**
   * Current log level
   */
  public loglevel: number;

  /**
   * Custom log filter
   * Return 'true' to skip output
   */
  public logFilter: ILoggerOptions['logFilter'] | undefined;

  /**
   * @constructor
   */
  public constructor({ logFilter, logLevel = 3 }: ILoggerOptions = {}) {
    this.loglevel = logLevel;
    this.logFilter = logFilter;
  }

  /**
   * @inheritDoc
   */
  public clearScreen(): void {
    //
  }

  /**
   * Should we skip current log depends on current log level
   */
  protected shouldSkipLog(level: number): boolean {
    return level > this.loglevel;
  }

  /**
   * Common log
   */
  protected log(params: ILogParams): void {
    const { level, msg, options } = params;

    if (this.shouldSkipLog(LogLevels[level]) || this.logFilter?.(params)) {
      return;
    }

    const args = [msg, options?.error].filter(Boolean);

    console[level](...args);
  }

  /**
   * @inheritDoc
   */
  public error(msg: string, options?: LogErrorOptions): void {
    this.log({ msg, options, level: 'error' });
  }

  /**
   * @inheritDoc
   */
  public hasErrorLogged(): boolean {
    return false;
  }

  /**
   * @inheritDoc
   */
  public info(msg: string, options: LogOptions): void {
    this.log({ msg, options, level: 'info' });
  }

  /**
   * @inheritDoc
   */
  public warn(msg: string, options: LogOptions): void {
    this.log({ msg, options, level: 'warn' });
  }

  /**
   * @inheritDoc
   */
  public warnOnce(msg: string, options: LogOptions): void {
    this.warn(msg, options);
  }
}

export default Logger;
