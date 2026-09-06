import { expect, test } from '@playwright/test';
import { collectStreamTimeline, expectHydrated } from '../lib/testing/playwright.js';

/** Preserve ordinary footer hydration alongside deferred stream hydration. */
test('hydrates footer and deferred router state with the bundled decoder', async ({ page }) => {
  // The hydration helpers observe the document from navigation onwards.
  await collectStreamTimeline(page);
  await page.goto('http://127.0.0.1:4179/footer');
  await page.getByRole('button', { name: 'Count 0' }).click();
  await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible();
  await expectHydrated(page);

  await page.goto('http://127.0.0.1:4179/deferred');
  await expect(page.locator('[data-resolved]')).toHaveText('Users: 3');
  await expectHydrated(page);
});
