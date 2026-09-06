import { defineConfig } from 'vitest/config';
import MakeAliases from './src/plugins/make-aliases';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.{ts,tsx,js}'],
    setupFiles: ['__helpers__/setup.ts'],
    coverage: {
      include: ['src/**/*'],
      exclude: ['src/interfaces/**', 'src/cli.ts', 'src/cli/commands.ts'],
      reporter: ['text', 'text-summary', 'lcov', 'html'],
    },
    environment: 'jsdom',
  },
  plugins: [MakeAliases()],
});
