import { rmSync } from 'node:fs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import { folderInput } from 'rollup-plugin-folder-input';
import copy from 'rollup-plugin-copy';
import { preserveShebangs } from 'rollup-plugin-preserve-shebangs';
import { replaceTscAliasPaths } from 'tsc-alias';

const dest = 'lib';

// Do not publish stale modules or declarations from earlier builds.
rmSync(dest, { force: true, recursive: true });

export default {
  input: [
    'src/**/*.ts*',
  ],
  output: {
    dir: dest,
    format: 'es',
    sourcemap: true,
    preserveModules: true,
    preserveModulesRoot: 'src',
    exports: 'auto',
  },
  external: [
    'fs',
    'path',
    'url',
    'compression',
    'express',
    'react',
    'readline',
    'hjson',
    'node:perf_hooks',
    'node:path',
    'node:dns',
    'node:os',
    'node:process',
    'node:child_process',
    'node:fs',
    'node:fs/promises',
    'node:stream',
    'node:zlib',
    'node:url',
    'node:util',
    'node:http',
    'node:module',
    'node:https',
    '@babel/types',
  ],
  plugins: [
    folderInput(),
    peerDepsExternal({
      includeDependencies: true,
    }),
    typescript({ tsconfig: './tsconfig.build.json', filterRoot: '.' }),
    preserveShebangs(),
    terser(),
    copy({
      targets: [
        {
          src: 'package.json',
          dest,
          transform(contents) {
            const metadata = JSON.parse(contents.toString());
            // Published consumers and directory packing do not need checkout Git hooks.
            delete metadata.scripts.prepare;
            return `${JSON.stringify(metadata, null, 2)}\n`;
          },
        },
        { src: 'README.md', dest: dest },
        { src: 'SECURITY.md', dest: dest },
        { src: 'LICENSE', dest: dest },
        { src: 'workflow', dest: dest },
      ]
    }),
    {
      name: 'resolve-declaration-imports',
      async writeBundle() {
        await replaceTscAliasPaths({
          configFile: './tsconfig.build.json',
          resolveFullPaths: true,
          resolveFullExtension: '.js',
        });
      },
    },
  ],
};
