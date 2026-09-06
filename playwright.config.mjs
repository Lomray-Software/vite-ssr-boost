import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-tests',
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  webServer: {
    command: 'node scripts/browser-server.mjs',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
