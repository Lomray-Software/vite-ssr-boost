import chalk from 'chalk';
import type { Logger, ResolvedServerUrls } from 'vite';

/**
 * Print server urls
 * @see https://github.com/vitejs/vite/blob/711dd807610b39538e9955970145d52e4ca1d8c0/packages/vite/src/node/logger.ts#LL142C1-L162C2
 * vite not export this function
 */
function printServerUrls(urls: ResolvedServerUrls, info: Logger['info']): void {
  const colorUrl = (url: string) =>
    chalk.cyan(url.replace(/:(\d+)\//, (_, port) => `:${chalk.bold(port)}/`));
  for (const url of urls.local) {
    info(`  ${chalk.green('➜')}  ${chalk.bold('Local')}:   ${colorUrl(url)}`);
  }
  for (const url of urls.network) {
    info(`  ${chalk.green('➜')}  ${chalk.bold('Network')}: ${colorUrl(url)}`);
  }
}

export default printServerUrls;
