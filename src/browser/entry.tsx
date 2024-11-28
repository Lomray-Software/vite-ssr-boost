import type { FC, PropsWithChildren } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { DataRouter, RouteObject } from 'react-router';
import { createBrowserRouter, matchRoutes, RouterProvider } from 'react-router';
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
  const lazyMatches = matchRoutes(
    routes as RouteObject[],
    window.location,
    routerOptions?.basename,
  )?.filter((m) => m.route.lazy);

  // Load the lazy matches and update the routes before creating router,
  // so we can hydrate the SSR-rendered content synchronously
  if (lazyMatches && lazyMatches?.length > 0) {
    await Promise.all(
      lazyMatches.map(async (m) => {
        const routeModule = await m.route.lazy?.();

        Object.assign(m.route, {
          ...routeModule,
          lazy: undefined,
        });
      }),
    );
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
