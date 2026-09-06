import type { FC, PropsWithChildren } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { DataRouter, RouteObject } from 'react-router';
import { createBrowserRouter, matchRoutes, RouterProvider } from 'react-router';
import receiveStream from '@browser/stream';
import { IS_SSR_MODE } from '@constants/common';
import type { TRouteObject } from '@interfaces/route-object';

export interface IAppClientProps<T = undefined> {
  client: T;
}

export interface IInitPropsParams {
  isSSRMode: boolean;
  router: DataRouter;
}

export type TApp<T> = FC<PropsWithChildren<IAppClientProps<T>>>;

export interface IEntryClientOptions<T> {
  init?: (params: IInitPropsParams) => Promise<T>;
  routerOptions?: Parameters<typeof createBrowserRouter>[1];
  createRouter?: typeof createBrowserRouter;
  rootId?: string;
}

/**
 * Wait for the shell and state when an async entry runs before HTML parsing finishes.
 */
const waitForDocument = (): Promise<void> | void => {
  const hydrationKey = '__staticRouterHydrationData';

  if (
    document.readyState !== 'loading' ||
    (IS_SSR_MODE && Reflect.get(window, hydrationKey) !== undefined)
  ) {
    return;
  }

  return new Promise<void>((resolve) => {
    const onReady = () => {
      if (IS_SSR_MODE) {
        Reflect.deleteProperty(window, hydrationKey);
      }

      resolve();
    };

    document.addEventListener('DOMContentLoaded', onReady, { once: true });

    if (IS_SSR_MODE) {
      Object.defineProperty(window, hydrationKey, {
        configurable: true,
        enumerable: true,
        get: () => undefined,
        set: (value: unknown) => {
          Object.defineProperty(window, hydrationKey, {
            configurable: true,
            enumerable: true,
            writable: true,
            value,
          });
          document.removeEventListener('DOMContentLoaded', onReady);
          resolve();
        },
      });
    }
  });
};

/**
 * Render client side application
 */
async function entry<TAppProps>(
  App: TApp<TAppProps>,
  routes: TRouteObject[],
  {
    init,
    routerOptions,
    createRouter = createBrowserRouter,
    rootId = 'root',
  }: IEntryClientOptions<TAppProps> = {},
): Promise<ReactDOM.Root | void> {
  const stream = IS_SSR_MODE ? receiveStream() : undefined;
  const documentReady = waitForDocument();
  const lazyMatches = matchRoutes(
    routes as RouteObject[],
    window.location,
    routerOptions?.basename,
  )?.filter((m) => m.route.lazy);

  // Load the lazy matches and update the routes before creating router,
  // so we can hydrate the SSR-rendered content synchronously
  if (documentReady || lazyMatches?.length) {
    await Promise.all([
      documentReady,
      ...(lazyMatches ?? []).map(async (m) => {
        const { lazy } = m.route;

        if (typeof lazy === 'function') {
          const lazyResult = await lazy();

          if (lazyResult) {
            Object.assign(m.route, {
              ...lazyResult,
              lazy: undefined,
            });
          }
        }
      }),
    ]);
  }

  const hydration = Reflect.get(window, '__staticRouterHydrationData') as
    { __ssrBoostStream?: boolean } | undefined;

  if (stream && hydration?.__ssrBoostStream) {
    Reflect.set(window, '__staticRouterHydrationData', await stream.ready);
  }

  const router = createRouter(routes as RouteObject[], routerOptions);
  const root = document.getElementById(rootId) as HTMLElement;
  const appProps = (await init?.({ isSSRMode: IS_SSR_MODE, router })) as TAppProps;

  const AppComponent: FC = () => (
    <App client={appProps}>
      <RouterProvider router={router} />
    </App>
  );

  if (!IS_SSR_MODE || root.dataset['forceSpa'] === '1') {
    return ReactDOM.createRoot(root).render(<AppComponent />);
  }

  return ReactDOM.hydrateRoot(root, <AppComponent />);
}

export default entry;

export { entry };
