#!/usr/bin/env node

import { parseStartOptions, runStart } from '@cli/start';

const [command, ...args] = process.argv.slice(2);
const options = command === 'start' ? parseStartOptions(args) : undefined;

if (options) {
  global.viteBoostAction = 'start';
  await runStart(options);
} else {
  await import('@cli/commands');
}
