import { fileURLToPath, URL } from 'node:url';
import type { Alias } from 'vite';

const cleanupPath = (path: string) => path.replace('./', '/').replace(/([^:]\/)\/+/g, '$1');

/**
 * Set vite aliases
 */
const viteAliases = (aliases: [string, string][], root = ''): Alias[] =>
  aliases.map(([find, path]) => ({
    find,
    replacement: fileURLToPath(new URL(`${root}${cleanupPath(path)}`, import.meta.url)),
  }));

export default viteAliases;
