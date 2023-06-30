import type { FC, PropsWithChildren } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { RouteObject } from 'react-router-dom';
import { createBrowserRouter, matchRoutes, RouterProvider } from 'react-router-dom';
import { IS_SSR_MODE } from '@constants/common';

export interface IEntryClientOptions {
  routes: RouteObject[];
}

export interface IAppClientProps<T = undefined> {
  client: T;
}

export interface IInitPropsParams {
  isSSRMode: boolean;
}

export type TApp<T> = FC<PropsWithChildren<IAppClientProps<T>>>;

export type TAppGetProps<T> = (params: IInitPropsParams) => Promise<T>;

/**
 * Render client side application
 */
async function entry<TAppProps>(
  { routes }: IEntryClientOptions,
  App: TApp<TAppProps>,
  initProps?: TAppGetProps<TAppProps>,
): Promise<ReactDOM.Root | void> {
  const lazyMatches = matchRoutes(routes, window.location)?.filter((m) => m.route.lazy);

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

  const appProps = (await initProps?.({ isSSRMode: IS_SSR_MODE })) as TAppProps;
  const router = createBrowserRouter(routes);
  const root = document.getElementById('root') as HTMLElement;

  const AppComponent: FC = () => (
    <App client={appProps}>
      <RouterProvider router={router} />
    </App>
  );

  if (!IS_SSR_MODE) {
    return ReactDOM.createRoot(root).render(<AppComponent />);
  }

  return ReactDOM.hydrateRoot(root, <AppComponent />);
}

export default entry;
