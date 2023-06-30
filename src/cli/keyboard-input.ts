import chalk from 'chalk';
import cliContext from '@constants/cli-context';
import defaultShortcuts from '@constants/cli-shortcuts';
import getPluginConfig from '@helpers/plugin-config';
import processStop from '@helpers/process-stop';

let isActionRunning = false;

/**
 * Handle keyboard press buttons
 */
function onKeyPress(input: string): void {
  void runAction(input);
}

/**
 * Run shortcut
 */
async function runAction(input: string): Promise<void> {
  // ctrl+c or ctrl+d
  if (input === '\x03' || input === '\x04') {
    if (!cliContext.server?.close((e) => processStop(e ? 1 : 0))) {
      processStop();
    }

    return;
  }

  if (isActionRunning) {
    return;
  }

  const { config } = cliContext;
  const Logger = config?.getLogger();
  const { customShortcuts = [] } =
    typeof config?.getVite()?.config === 'object' ? getPluginConfig(config.getVite()!.config) : {};

  const shortcuts = customShortcuts
    .filter(Boolean)
    .concat(defaultShortcuts)
    .filter(({ isOnlyDev = false }) => !isOnlyDev || (isOnlyDev && !config?.isProd));

  // print empty line
  if (input === '\r') {
    return Logger?.info('\r');
  }

  // print help
  if (input === 'h') {
    Logger?.info(
      [
        '',
        chalk.bold('  Shortcuts'),
        ...shortcuts.map(
          (shortcut) =>
            chalk.dim('  press ') +
            chalk.bold(shortcut.key) +
            chalk.dim(` to ${shortcut.description}`),
        ),
      ].join('\n'),
    );
  }

  // execute shortcut command
  const shortcut = shortcuts.find(({ key }) => key === input);

  if (!shortcut) {
    return;
  }

  isActionRunning = true;
  await shortcut.action(cliContext);
  isActionRunning = false;
}

export default onKeyPress;
