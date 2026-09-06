import { expect, test } from '@playwright/test';

test('document navigation switches from guest caching to private after a session cookie', async ({ page, context }) => {
  const guest = await page.goto('http://127.0.0.1:4179/');
  expect(guest.headers()['cache-control']).toBe('public, max-age=0, s-maxage=30');
  await context.addCookies([{ name: 'session', value: 'browser-session', url: 'http://127.0.0.1:4179' }]);
  const account = await page.reload();
  expect(account.headers()['cache-control']).toBe('private, no-store');
  expect(account.headers().vary ?? '').not.toMatch(/cookie/i);
  await context.clearCookies();
  const loggedOut = await page.reload();
  expect(loggedOut.headers()['cache-control']).toBe('public, max-age=0, s-maxage=30');
});
