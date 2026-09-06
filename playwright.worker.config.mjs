import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-tests/worker',
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4180' },
  webServer: {
    command: 'node scripts/worker-browser-server.mjs',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
