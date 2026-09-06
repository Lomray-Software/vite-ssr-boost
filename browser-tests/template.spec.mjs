import { test, expect } from '@playwright/test';

test('pinned template deferred shell hydrates and both user lists settle without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Observe the actual init/resolve frames, even when hydration consumes them.
  await page.addInitScript(() => {
    const frames = [];
    const queue = [];
    const seen = new WeakSet();
    let push = queue.push.bind(queue);
    Object.defineProperty(queue, 'push', {
      get: () => (...entries) => {
        for (const frame of entries) {
          if (!seen.has(frame)) frames.push(frame);
          seen.add(frame);
        }
        return push(...entries);
      },
      // The stream receiver replaces push and replays the original queue.
      set: (receive) => { push = receive; },
    });
    window.__ssrBoostStream = queue;
    window.acceptanceFrames = frames;
  });
  await page.goto('./deferred', { waitUntil: 'commit' });
  await expect(page).toHaveTitle('Deferred data');
  await expect(page.getByText('Loading users with Await…', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading users with use()…', { exact: true })).toBeVisible();
  const counter = page.getByRole('button', { name: 'Count: 0', exact: true });
  // The shell is interactive once React has hydrated the button: clicks made before the
  // client modules load are dropped, which happens in development where Vite serves them unbundled.
  await counter.waitFor();
  await page.waitForFunction(
    (button) => Object.keys(button).some((key) => key.startsWith('__reactProps')),
    await counter.elementHandle(),
    { timeout: 20_000 },
  );
  await counter.click();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  for (const section of ['Users with Await', 'Users with React use()']) {
    const region = page.getByRole('region', { name: section, exact: true });
    await expect(region.getByRole('listitem')).toHaveText([
      'Ada Lovelace', 'Grace Hopper', 'Margaret Hamilton',
    ]);
    await expect(region.getByRole('list')).toHaveCount(1);
  }
  await expect(page.getByText(/^Loading users with/)).toHaveCount(0);
  const frames = await page.evaluate(() => window.acceptanceFrames);
  expect(frames[0][0]).toBe('init');
  expect(frames[0][1]).toContain('SSRBPromise');
  expect(frames.filter(([type]) => type === 'resolve')).toHaveLength(1);
  await page.getByRole('button', { name: 'Count: 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Count: 2', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
