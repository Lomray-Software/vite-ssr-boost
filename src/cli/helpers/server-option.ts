import { Option } from 'commander';

/**
 * Managed server selection shared by dev, start and preview; the value is required.
 */
const serverOption = new Option(
  '--server <server>',
  'Managed server: node or express (default: plugin managedServer, then express).',
).choices(['node', 'express']);

export default serverOption;
