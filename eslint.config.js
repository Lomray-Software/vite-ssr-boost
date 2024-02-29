import lomrayConfig from '@lomray/eslint-config-react';
// noinspection NpmUsedModulesInstalled
import baseConfig from '@lomray/eslint-config';
// noinspection NpmUsedModulesInstalled
import globals from 'globals';

export default [
  ...lomrayConfig.config(),
  {
    ...baseConfig['filesIgnores'],
    languageOptions: {
      globals: {
        ...globals.node,
        NodeJS: true,
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 0,
    }
  },
];
