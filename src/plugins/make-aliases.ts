import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import JSON5 from 'json5';
import type { Plugin } from 'vite';
// import without aliases for use in vitest.config.ts
import PLUGIN_NAME from '../constants/plugin-name';
import ViteAliases from '../helpers/vite-aliases';

export interface IPluginOptions {
  root?: string; // default: cwd()
  tsconfig?: string; // default: tsconfig.json
}

const pluginName = `${PLUGIN_NAME}-make-aliases`;
const cleanupAlias = (str: string): string => str.replace('/*', '');

/**
 * Read tsconfig file and set vite aliases
 * @see PathNormalize.getAliases
 * @constructor
 */
function ViteMakeAliasesPlugin(options: IPluginOptions = {}): Plugin {
  const { root, tsconfig } = options;
  const projectRoot = root ?? process.cwd();
  const tsconfigPath = path.resolve(projectRoot, tsconfig ?? 'tsconfig.json');
  const aliases: [string, string][] = [];

  if (!fs.existsSync(tsconfigPath)) {
    console.error(`${pluginName}: tsconfig not exist in "${tsconfigPath}"`);
  } else {
    const tsJson = JSON5.parse<{ compilerOptions?: { paths: Record<string, string[]> } }>(
      fs.readFileSync(tsconfigPath, { encoding: 'utf-8' }),
    );
    const paths = tsJson?.compilerOptions?.paths ?? {};

    Object.entries(paths).forEach(([alias, aliasPaths]) => {
      aliases.push([cleanupAlias(alias), cleanupAlias(aliasPaths[0])]);
    });
  }

  return {
    name: pluginName,
    config(config) {
      if (aliases.length) {
        const resolveConfig = config.resolve ?? {};
        const defaultAliases = resolveConfig.alias ?? [];
        const normalizedAliases = Array.isArray(defaultAliases)
          ? defaultAliases
          : Object.entries(defaultAliases).map(([find, val]) => ({
              find,
              replacement: val as string,
            }));

        normalizedAliases.push(...ViteAliases(aliases, `${projectRoot}/${config?.root ?? ''}`));

        config.resolve = {
          ...resolveConfig,
          alias: normalizedAliases,
        };
      }

      return config;
    },
  };
}

export default ViteMakeAliasesPlugin;
