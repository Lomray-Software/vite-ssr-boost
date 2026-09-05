import lomrayConfig from '@lomray/eslint-config-react';
import baseConfig from '@lomray/eslint-config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      ...baseConfig.filesIgnores.ignores,
      'coverage/**',
      'docs/**',
      'lib/**',
      'node_modules/**',
      '*.js',
    ],
  },
  ...lomrayConfig.config(),
  {
    files: ['**/*.{ts,tsx,d.ts}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        NodeJS: true,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 0,
    },
  },
  {
    files: [
      '__tests__/**/*.{ts,tsx}',
      '__mocks__/**/*.{ts,tsx}',
      '__helpers__/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 0,
      '@typescript-eslint/no-unsafe-call': 0,
      '@typescript-eslint/no-unsafe-member-access': 0,
      '@typescript-eslint/no-unsafe-return': 0,
      '@typescript-eslint/no-unsafe-argument': 0,
      '@typescript-eslint/consistent-type-imports': 0,
      '@typescript-eslint/require-await': 0,
      '@typescript-eslint/await-thenable': 0,
      '@typescript-eslint/no-floating-promises': 0,
      'padding-line-between-statements': 0,
      'import-x/no-duplicates': 0,
      'import-x/prefer-default-export': 0,
      'unicorn/error-message': 0,
      'sonarjs/no-duplicate-string': 0,
    },
  },
];
