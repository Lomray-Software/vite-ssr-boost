import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  testMatch: 'template.spec.mjs',
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: process.env.TEMPLATE_BROWSER_ORIGIN,
    // Exercise the template's human streaming mode, without HeadlessChrome bot detection.
    userAgent: 'Mozilla/5.0',
  },
});
