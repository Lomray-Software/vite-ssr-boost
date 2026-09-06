import { expect, test } from '@playwright/test';

test('hydrates workerd HTML, preserves client state across navigation and loads lazy CSS', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /hydrat|did not match|Minified React error/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Count 0' }).click();
  await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible();
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lazy Worker route' })).toHaveCSS(
    'color',
    'rgb(12, 34, 56)',
  );
  await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Lazy Worker route' })).toHaveCSS(
    'color',
    'rgb(12, 34, 56)',
  );
  await page.getByRole('button', { name: 'Count 0' }).click();
  await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('hydrates the pending shell before a deferred workerd boundary resolves', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /hydrat|did not match|Minified React error/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto('/deferred', { waitUntil: 'commit' });
  await expect(page.locator('[data-fallback]')).toBeVisible();
  await page.getByRole('button', { name: 'Count 0' }).click();
  await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible();
  await expect(page.locator('[data-fallback]')).toBeVisible();
  await expect(page.locator('[data-resolved]')).toHaveText('Resolved in workerd');
  await expect(page.locator('[data-fallback]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
