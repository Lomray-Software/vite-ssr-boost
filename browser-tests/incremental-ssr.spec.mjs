import { test, expect, chromium } from '@playwright/test';

test('SPA and SSR routes share navigation, reloads, cookies and browser loader redirects', async () => {
  let browser;
  try {
    browser = await chromium.launch({ timeout: 10_000 });
  } catch (error) {
    const reason = error.message.split('\n').find((line) => line.includes('Permission denied')) || error.message.split('\n')[0];
    console.info(`SKIP Chromium: ${reason}`);
    test.skip(true, `Chromium cannot launch in this environment: ${reason}`);
    return;
  }
  try {
    // Headless Chromium reports HeadlessChrome, which isbot classifies as a crawler and the
    // fixture's bots: 'ssr' default would then render /spa on the server.
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
    await context.addCookies([{ name: 'session', value: 'known', url: 'http://127.0.0.1:4179' }]);
    const page = await context.newPage();
    const errors = [];
    let documents = 0;
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents += 1;
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    const spa = await page.goto('http://127.0.0.1:4179/spa');
    expect(await spa.text()).not.toContain('__staticRouterHydrationData');
    await expect(page.getByRole('heading', { name: 'SPA page' })).toBeVisible();
    await expect(page.getByText('Browser loader')).toBeVisible();
    await page.evaluate(() => { window.documentIdentity = 'same document'; });
    await page.getByRole('link', { name: 'Public', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Public page' })).toBeVisible();
    await page.getByRole('link', { name: 'SPA', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'SPA page' })).toBeVisible();
    expect(documents).toBe(1);
    expect(await page.evaluate(() => window.documentIdentity)).toBe('same document');

    await page.reload();
    await expect(page.getByText('Browser loader')).toBeVisible();
    const publicResponse = await page.goto('http://127.0.0.1:4179/public');
    const publicHtml = await publicResponse.text();
    expect(publicHtml).toContain('__staticRouterHydrationData');
    expect(publicHtml).toContain('session=known');
    await expect(page.locator('[data-cookie]')).toContainText('session=known');
    const initialDocuments = documents;
    await page.getByRole('link', { name: 'SPA', exact: true }).click();
    await expect(page.getByText('Browser loader')).toBeVisible();
    await page.getByRole('link', { name: 'Public', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Public page' })).toBeVisible();
    expect(documents).toBe(initialDocuments);

    const redirectShell = await page.goto('http://127.0.0.1:4179/spa-redirect', { waitUntil: 'commit' });
    expect(redirectShell.status()).toBe(200);
    expect(await redirectShell.text()).toContain('data-force-spa="1"');
    await expect(page).toHaveURL('http://127.0.0.1:4179/public');
    await expect(page.getByRole('heading', { name: 'Public page' })).toBeVisible();
    expect(documents).toBe(initialDocuments + 1);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
