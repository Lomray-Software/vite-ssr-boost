import { afterEach, expect, it, vi } from 'vitest';
import receiveStream from '@browser/stream';
import DataStream from '@core/data-stream';
import { installBrowserObserver, inspectHydration } from '../../src/testing/browser-observer';

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(window, '__ssrBoostTest');
  Reflect.deleteProperty(window, '__ssrBoostStream');
  Reflect.deleteProperty(window, '__staticRouterHydrationData');
  vi.restoreAllMocks();
});

it('captures custom-root SSR before hydration, catches console errors and detects added duplicate text', () => {
  installBrowserObserver();
  document.body.innerHTML =
    '<section id="app"><p>Hello SSR</p><p>Repeated</p><p>Repeated</p></section>';
  Reflect.set(window, '__staticRouterHydrationData', {});
  window.dispatchEvent(
    new CustomEvent('ssr-boost:router-ready', { detail: { rootId: 'app' } }),
  );
  expect(inspectHydration('#app')).toMatchObject({
    ready: true,
    consumed: false,
    duplicates: [],
  });
  Reflect.deleteProperty(window, '__staticRouterHydrationData');
  document.querySelector('#app')!.insertAdjacentHTML('beforeend', '<p>Hello SSR</p>');
  console.error('Minified React error #418');
  expect(inspectHydration('#app')).toMatchObject({
    consumed: true,
    duplicates: ['Hello SSR'],
    errors: ['Minified React error #418'],
  });
  expect(inspectHydration('#missing').ready).toBe(false);
  document.querySelector('#app')!.innerHTML = '<p>Hello SSRHello SSR</p>';
  expect(inspectHydration('#app').duplicates).toEqual(['Hello SSR']);
});

it('observes frames even after the receiver replaces push, without replaying frames twice', async () => {
  installBrowserObserver();
  const stream = new DataStream({
    loaderData: { root: { value: 42 } },
    actionData: null,
    errors: null,
  } as never);
  const queue = Reflect.get(window, '__ssrBoostStream') as unknown[][];
  queue.push(['init', stream.initial, false]);
  const receiver = receiveStream();
  expect(await receiver.ready).toMatchObject({ loaderData: { root: { value: 42 } } });
  queue.push(['resolve', 7, '[42]']);
  expect(window.__ssrBoostTest!.events.map((event) => event.stage)).toEqual([
    'init',
    'resolve',
  ]);
});
