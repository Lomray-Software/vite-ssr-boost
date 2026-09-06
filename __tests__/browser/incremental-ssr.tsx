import { act, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { DataRouter } from 'react-router';
import { redirect, useLoaderData } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import entry from '@browser/entry';

let root: ReactDOM.Root | undefined;
let router: DataRouter | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  router?.dispose();
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete document.documentElement.dataset.forceSpa;
  window.history.replaceState({}, '', '/');
});

describe('incremental SSR browser entry', () => {
  it.each(['root', 'document'])(
    'mounts the %s SPA marker, runs browser loaders and navigates both directions',
    async (marker) => {
      document.body.innerHTML = `<div id="app" ${marker === 'root' ? 'data-force-spa="1"' : ''}></div>`;
      if (marker === 'document') document.documentElement.dataset.forceSpa = '1';
      window.history.replaceState({}, '', '/spa');
      Reflect.deleteProperty(window, '__staticRouterHydrationData');
      const createRoot = vi.spyOn(ReactDOM, 'createRoot');
      const hydrate = vi.spyOn(ReactDOM, 'hydrateRoot');
      const loader = vi.fn(() => 'loaded in browser');
      const redirectLoader = vi.fn(() => redirect('/public'));
      const init = vi.fn(async (params) => {
        router = params.router;
      });
      await act(async () => {
        await entry(
          ({ children }) => children,
          [
            {
              path: '/spa',
              loader,
              HydrateFallback: () => null,
              Component: () => <p>SPA: {useLoaderData() as string}</p>,
            },
            { path: '/public', Component: () => <p>Public page</p> },
            { path: '/redirect', loader: redirectLoader, HydrateFallback: () => null },
          ],
          { rootId: 'app', init },
        );
      });
      root = createRoot.mock.results[0].value;
      expect(init.mock.calls[0][0].isSSRMode).toBe(false);
      await waitFor(() => expect(document.body.textContent).toBe('SPA: loaded in browser'));
      const documentRoot = document.getElementById('app');
      await act(async () => router!.navigate('/public'));
      expect(document.body.textContent).toBe('Public page');
      await act(async () => router!.navigate('/spa'));
      expect(document.body.textContent).toBe('SPA: loaded in browser');
      expect(loader).toHaveBeenCalledTimes(2);
      await act(async () => router!.navigate('/redirect'));
      expect(router!.state.location.pathname).toBe('/public');
      expect(redirectLoader).toHaveBeenCalledOnce();
      expect(document.getElementById('app')).toBe(documentRoot);
      expect(createRoot).toHaveBeenCalledOnce();
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
});
