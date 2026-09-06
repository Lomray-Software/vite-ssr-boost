import type { Page } from '@playwright/test';
import { installBrowserObserver, inspectHydration } from './browser-observer';
import type { IBrowserTimelineEvent } from './browser-observer';

interface IHydratedOptions {
  root?: string;
  timeout?: number;
}

interface IStreamTimelineCollector {
  read: () => Promise<IBrowserTimelineEvent[]>;
}

const installed = new WeakSet<Page>();

/** Install before navigation so console failures and the original SSR DOM cannot be missed. */
const collectStreamTimeline = async (page: Page): Promise<IStreamTimelineCollector> => {
  if (!installed.has(page)) {
    await page.addInitScript(installBrowserObserver);
    installed.add(page);
  }

  return {
    read: () => page.evaluate(() => window.__ssrBoostTest?.events ?? []),
  };
};

/** Wait for router creation, all streamed boundaries and a browser rendering opportunity. */
const expectHydrated = async (
  page: Page,
  { root = '#root', timeout = 5_000 }: IHydratedOptions = {},
): Promise<void> => {
  const { expect } = await import('@playwright/test');

  expect(installed.has(page), 'Call collectStreamTimeline(page) before page.goto().').toBe(true);
  await expect
    .poll(async () => (await page.evaluate(inspectHydration, root)).ready, {
      timeout,
      message: `SSR router was not created for ${root}. Use the SSR Boost browser entry.`,
    })
    .toBe(true);
  await page.waitForLoadState('load', { timeout });
  await expect
    .poll(async () => (await page.evaluate(inspectHydration, root)).pending, {
      timeout,
      message: 'Streamed Suspense boundaries did not settle.',
    })
    .toBe(0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const result = await page.evaluate(inspectHydration, root);

  expect(result.consumed, 'Router hydration state was not consumed.').toBe(true);
  expect(result.errors, 'React reported hydration errors.').toEqual([]);
  expect(result.duplicates, 'Server text was duplicated during hydration.').toEqual([]);
};

/** Require an observed shell before this element first became visible. */
const expectStreamed = async (page: Page, selector: string): Promise<void> => {
  const { expect } = await import('@playwright/test');

  expect(installed.has(page), 'Call collectStreamTimeline(page) before page.goto().').toBe(true);
  const element = page.locator(selector);

  await expect(element).toBeVisible();
  const timing = await element.evaluate((node) => ({
    shell: window.__ssrBoostTest?.shellAt,
    element: window.__ssrBoostTest?.seen.get(node),
  }));

  expect(timing.shell, 'No server shell was observed.').toBeDefined();
  expect(timing.element, 'The element was not observed during this navigation.').toBeDefined();
  expect(timing.element!, 'The element must appear after the shell.').toBeGreaterThan(
    timing.shell!,
  );
};

export { collectStreamTimeline, expectHydrated, expectStreamed };

export type { IBrowserTimelineEvent, IHydratedOptions, IStreamTimelineCollector };
