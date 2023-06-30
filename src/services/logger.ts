import type { Logger as ViteLogger } from 'vite';

/**
 * Default production logger
 */
class Logger implements ViteLogger {
  /**
   * @inheritDoc
   */
  hasWarned: boolean;

  /**
   * @inheritDoc
   */
  clearScreen(): void {
    //
  }

  /**
   * @inheritDoc
   */
  error(msg: string): void {
    console.error(msg);
  }

  /**
   * @inheritDoc
   */
  hasErrorLogged(): boolean {
    return false;
  }

  /**
   * @inheritDoc
   */
  info(msg: string): void {
    console.info(msg);
  }

  /**
   * @inheritDoc
   */
  warn(msg: string): void {
    console.warn(msg);
  }

  /**
   * @inheritDoc
   */
  warnOnce(msg: string): void {
    console.warn(msg);
  }
}

export default Logger;
