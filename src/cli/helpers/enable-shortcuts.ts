/**
 * Load keyboard handling only for interactive CLI sessions.
 */
const enableShortcuts = async (): Promise<void> => {
  if (process.stdin.isTTY) {
    const { default: onKeyPress } = await import('@cli/helpers/keyboard-input');

    process.stdin.setRawMode(true);
    process.stdin.on('data', onKeyPress).setEncoding('utf8').resume();
  }
};

export default enableShortcuts;
