import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  test: {
    include: ['__tests__/**/*'],
    setupFiles: ['__helpers__/setup.ts'],
    coverage: {
      include: ['src/**/*'],
      exclude: ['src/interfaces/**'],
      reporter: ['text', 'text-summary', 'lcov', 'html'],
    }
  },
  plugins: [tsconfigPaths()],
});
