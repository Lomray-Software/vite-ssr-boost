import { test, expect } from '@playwright/test';
import {
  collectStreamTimeline,
  expectHydrated,
  expectStreamed,
} from '../lib/testing/playwright.js';

test('hydration assertions detect duplicated server text and unconsumed state', async ({
  page,
}) => {
  await collectStreamTimeline(page);
  await page.goto('http://127.0.0.1:4179/');
  await expectHydrated(page);
  await page.locator('button').evaluate((button) => button.after(button.cloneNode(true)));
  await expect(expectHydrated(page)).rejects.toThrow('Server text was duplicated');
  await page
    .locator('button')
    .last()
    .evaluate((button) => button.remove());
  await page.evaluate(() => {
    window.__staticRouterHydrationData = {};
  });
  await expect(expectHydrated(page)).rejects.toThrow(
    'Router hydration state was not consumed',
  );
});

for (const code of [418, 423, 425]) {
  test(`retains React #${code} console errors emitted before hydration`, async ({ page }) => {
    await collectStreamTimeline(page);
    await page.route('http://127.0.0.1:4179/', async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        '<head>',
        `<head><script>console.error('Minified React error #${code}');</script>`,
      );
      await route.fulfill({ response, body });
    });
    await page.goto('http://127.0.0.1:4179/');
    await expect(expectHydrated(page)).rejects.toThrow('React reported hydration errors');
  });
}

test('rejects an element already present in the initial shell', async ({ page }) => {
  await collectStreamTimeline(page);
  await page.goto('http://127.0.0.1:4179/');
  await expectHydrated(page);
  await expect(expectStreamed(page, 'button')).rejects.toThrow(
    'The element must appear after the shell',
  );
});
