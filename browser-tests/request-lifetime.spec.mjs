import { expect, test } from '@playwright/test';
import { collectStreamTimeline, expectHydrated } from '../lib/testing/playwright.js';

/**
 * Keep deferred hydration and subsequent documents intact after completed-request cleanup.
 */
test('completed requests do not cancel a later deferred response', async ({ page, request }) => {
  await collectStreamTimeline(page);

  for (let index = 0; index < 20; index += 1) {
    const response = await request.get('http://127.0.0.1:4179/footer');

    expect(response.status()).toBe(200);
    await response.body();
    await response.dispose();
  }

  await page.goto('http://127.0.0.1:4179/deferred');
  await expect(page.locator('[data-resolved]')).toHaveText('Users: 3');
  await expectHydrated(page);
  await page.goto('http://127.0.0.1:4179/footer');
  await page.getByRole('button', { name: 'Count 0' }).click();
  await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible();
  await expectHydrated(page);
});
