import typescript from 'rollup-plugin-ts';
import terser from '@rollup/plugin-terser';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import { folderInput } from 'rollup-plugin-folder-input';
import copy from 'rollup-plugin-copy';
import { preserveShebangs } from 'rollup-plugin-preserve-shebangs';

const dest = 'lib';
// const dest = '../vite-template/node_modules/@lomray/vite-ssr-boost';

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
    'node:url',
    'node:http',
    'node:https',
  ],
  plugins: [
    folderInput(),
    peerDepsExternal({
      includeDependencies: true,
    }),
    typescript({
      tsconfig: resolvedConfig => ({
        ...resolvedConfig,
        declaration: true,
        importHelpers: true,
        plugins: [
          {
            "transform": "@zerollup/ts-transform-paths",
            "exclude": ["*"]
          }
        ]
      }),
    }),
    preserveShebangs(),
    terser(),
    copy({
      targets: [
        { src: 'package.json', dest: dest },
        { src: 'README.md', dest: dest },
        { src: 'SECURITY.md', dest: dest },
        { src: 'LICENSE', dest: dest },
        { src: 'workflow', dest: dest },
      ]
    })
  ],
};
