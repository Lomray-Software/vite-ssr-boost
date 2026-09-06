import { test, expect, chromium } from '@playwright/test';

for (const mode of ['Await', 'use']) {
  test(`early shell is interactive within 300ms; ${mode} hydrates once and client loaders stay native`, async () => {
    let browser;
    try {
      browser = await chromium.launch({ timeout: 10_000 });
    } catch (error) {
      const reason =
        error.message.split('\n').find((line) => line.includes('Permission denied')) ||
        error.message.split('\n')[0];
      console.info(`SKIP Chromium: ${reason}`);
      test.skip(true, `Chromium cannot launch in this environment: ${reason}`);
      return;
    }
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
          if (document.querySelector('button')) {
            window.shellAt = performance.now();
            observer.disconnect();
          }
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      // Warm the built entry, matching the cached async-entry timing regression.
      await page.goto('http://127.0.0.1:4179/');
      await page.getByRole('button', { name: 'Count 0' }).click();
      await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible();
      await page.goto(`http://127.0.0.1:4179/deferred${mode === 'use' ? '?use=1' : ''}`, {
        waitUntil: 'commit',
      });
      await page.getByRole('button', { name: 'Count 0' }).click({ timeout: 300 });
      await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible({ timeout: 300 });
      const interactiveMs = await page.evaluate(() => performance.now() - window.shellAt);
      expect(interactiveMs).toBeLessThanOrEqual(300);
      await expect(page.locator('[data-fallback]')).toBeVisible();
      await expect(page.locator('[data-resolved]')).toHaveText('Users: 3');
      await expect(page.locator('[data-resolved]')).toHaveCount(1);
      await expect(page.locator('[data-fallback]')).toHaveCount(0);
      expect(errors).toEqual([]);
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await page.getByRole('link', { name: 'Deferred', exact: true }).click();
      await expect(page.locator('[data-resolved]')).toHaveText('Users: 3');
      await expect(page.locator('[data-resolved]')).toHaveCount(1);
      expect(errors).toEqual([]);
      console.info(
        `${mode}: shell interactive after ${Math.round(interactiveMs)}ms; no hydration errors or duplicates`,
      );
    } finally {
      await browser.close();
    }
  });
}
