import lomrayConfig from '@lomray/eslint-config-react';
// noinspection NpmUsedModulesInstalled
import baseConfig from '@lomray/eslint-config';
// noinspection NpmUsedModulesInstalled
import globals from 'globals';

const customFilesIgnores = {
  ...baseConfig['filesIgnores'],
  files: [
    ...baseConfig['filesIgnores'].files,
    '__tests__/**/*.{ts,tsx,*.ts,*tsx}',
    '__mocks__/**/*.{ts,tsx,*.ts,*tsx}',
    '__helpers__/**/*.{ts,tsx,*.ts,*tsx}',
  ],
}

export default [
  ...lomrayConfig.config(customFilesIgnores),
  {
    ...customFilesIgnores,
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
