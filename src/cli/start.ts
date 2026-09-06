import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import enableShortcuts from '@cli/helpers/enable-shortcuts';
import type { IStartActionParams } from '@cli/interfaces/actions';
import cliContext from '@constants/cli-context';

/**
 * Parse ordinary start invocations; delegate help and ambiguous syntax to Commander.
 */
const parseStartOptions = (args: string[]): IStartActionParams | undefined => {
  try {
    const { values } = parseArgs({
      args,
      options: {
        host: { type: 'boolean', default: false },
        port: { type: 'string', default: '3000' },
        'focus-only': { type: 'string', default: 'app' },
        'build-dir': { type: 'string' },
        'module-preload': { type: 'boolean', default: false },
      },
      allowPositionals: false,
    });
    const {
      host: isHost,
      port,
      'focus-only': focusOnly,
      'build-dir': buildDir,
      'module-preload': isModulePreload,
    } = values;

    if (!['all', 'app', 'client', 'server', 'entrypoint'].includes(focusOnly)) {
      return;
    }

    return {
      host: isHost,
      port: Number(port),
      focusOnly: focusOnly as IStartActionParams['focusOnly'],
      buildDir,
      modulePreload: isModulePreload,
    };
  } catch {
    return;
  }
};

/**
 * Start and restart the existing managed server without importing other commands.
 */
const runStart = async ({
  host,
  port,
  focusOnly,
  modulePreload,
  buildDir,
}: IStartActionParams): Promise<void> => {
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  const { default: runProd } = await import('@cli/run-prod');

  /**
   * Retain the managed server and configuration for interactive shortcuts.
   */
  const command = async (isPrintInfo?: boolean): Promise<void> => {
    const { server, config } = await runProd({
      version,
      isHost: host,
      isPrintInfo,
      port,
      focusOnly,
      modulePreload,
      buildDir,
    });

    cliContext.server = server;
    cliContext.config = config;
  };

  cliContext.reboot = command;
  await enableShortcuts();
  await command();
};

export { parseStartOptions, runStart };
