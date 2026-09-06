import React, { Suspense, useState } from 'react';
import type { Root } from 'react-dom/client';
import { Await, useLoaderData } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import entry from '@browser/entry';
import DataStream from '@core/data-stream';
import { streamScript } from '@core/script';

let root: Root | void;
const App = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
const Counter = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count {count}</button>;
};
const Page = () => {
  const { slow } = useLoaderData() as { slow: Promise<string> };
  return (
    <main>
      <Counter />
      <Suspense fallback={<p>Loading users</p>}>
        <Await resolve={slow}>{(value) => <p data-resolved>{value}</p>}</Await>
      </Suspense>
    </main>
  );
};
const scripts = () => {
  for (const script of [...document.querySelectorAll('script')]) {
    Object.defineProperty(document, 'currentScript', { configurable: true, value: script });
    new Function(script.textContent ?? '')();
  }
  Reflect.deleteProperty(document, 'currentScript');
};

afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.innerHTML = '';
  Reflect.deleteProperty(window, '__ssrBoostStream');
  Reflect.deleteProperty(window, '__staticRouterHydrationData');
  Reflect.deleteProperty(window, 'custom');
  vi.restoreAllMocks();
});

it('hydrates and clicks the shell before deferred frames are applied', async () => {
  let resolve!: (value: string) => void;
  const slow = new Promise<string>((res) => {
    resolve = res;
  });
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
  const routes = [{ id: 'root', path: '/', Component: Page, loader: () => ({ slow }) }];
  const stream = new DataStream({
    loaderData: { root: { slow } },
    actionData: null,
    errors: null,
  } as never);
  // Fizz's pending shell shape. Real Node/edge byte ordering is covered in the Node and edge integration suites.
  document.body.innerHTML = `<div id="root">${stream.state(true)}<main><button>Count <!-- -->0</button><!--$?--><template id="B:0"></template><p>Loading users</p><!--/$--></main>${streamScript(['shell'])}</div>`;
  Reflect.set(window, 'custom', { ready: true });
  scripts();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  root = await entry(App, routes, {
    init: async ({ router }) => {
      expect(Reflect.get(window, 'custom')).toEqual({ ready: true });
      expect((router.state.loaderData['root'] as any).slow).toBeInstanceOf(Promise);
    },
  });
  document.querySelector('button')!.click();
  await vi.waitFor(() => {
    expect(document.querySelector('button')!.textContent).toBe('Count 1');
  });
  expect(document.body.textContent).toContain('Loading users');
  expect(errors).not.toHaveBeenCalled();
  resolve('Users: 3');
  await stream.done;
  document.getElementById('root')!.insertAdjacentHTML('beforeend', stream.take());
  scripts();
  expect(errors).not.toHaveBeenCalled();
});
