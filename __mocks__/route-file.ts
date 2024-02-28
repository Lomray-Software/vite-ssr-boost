/**
 * Example route file
 */
const routesCode1Before = `
import type { TRouteObject } from '@lomray/vite-ssr-boost/interfaces/route-object';
import AppLayout from '@components/layouts/app';
import NotFound from '@pages/not-found';
import NotLazyPage from '@pages/not-lazy';
import RouteManager from '@services/route-manager';
import DetailsRoutes from './details';

/**
 * Application routes
 */
const routes: TRouteObject[] = [
  {
    ErrorBoundary: NotFound,
    Component: AppLayout,
    children: [
      {
        index: true,
        lazy: () => import('@pages/home'),
      },
      {
        path: RouteManager.path('details'),
        children: DetailsRoutes,
      },
      {
        path: RouteManager.path('errorBoundary'),
        lazy: () => import('@pages/error-boundary'),
      },
      {
        path: RouteManager.path('nestedSuspense'),
        lazy: () => import('@pages/nested-suspense'),
      },
      {
        path: RouteManager.path('redirect'),
        lazy: () => import('@pages/redirect'),
      },
      {
        path: RouteManager.path('redirect'),
        lazy: () => import('@pages/redirect'),
      },
      {
        path: RouteManager.path('notLazy'),
        Component: NotLazyPage,
      },
      {
        path: RouteManager.path('notLazy'),
        Component: NotLazyPage,
      },
      {
        Component: NotLazyPage,
        path: RouteManager.path('notLazy'),
      },
      { Component: NotLazyPage, path: RouteManager.path('notLazy') },
      { path: RouteManager.path('notLazy'), Component: NotLazyPage },
    ],
  },
];

export default routes;
`;

const routesCode1After = `import n from '@lomray/vite-ssr-boost/helpers/import-route';
import type { TRouteObject } from '@lomray/vite-ssr-boost/interfaces/route-object';
import AppLayout from '@components/layouts/app';
import NotFound from '@pages/not-found';
import NotLazyPage from '@pages/not-lazy';
import RouteManager from '@services/route-manager';
import DetailsRoutes from './details';

/**
 * Application routes
 */
const routes: TRouteObject[] = [
  {
    ErrorBoundary: NotFound,
    Component: AppLayout,pathId: '@components/layouts/app',
    children: [
      {
        index: true,
        lazy: ()=>n(() => import('@pages/home'),'@pages/home'),
      },
      {
        path: RouteManager.path('details'),
        children: DetailsRoutes,
      },
      {
        path: RouteManager.path('errorBoundary'),
        lazy: ()=>n(() => import('@pages/error-boundary'),'@pages/error-boundary'),
      },
      {
        path: RouteManager.path('nestedSuspense'),
        lazy: ()=>n(() => import('@pages/nested-suspense'),'@pages/nested-suspense'),
      },
      {
        path: RouteManager.path('redirect'),
        lazy: ()=>n(() => import('@pages/redirect'),'@pages/redirect'),
      },
      {
        path: RouteManager.path('redirect'),
        lazy: ()=>n(() => import('@pages/redirect'),'@pages/redirect'),
      },
      {
        path: RouteManager.path('notLazy'),
        Component: NotLazyPage,pathId: '@pages/not-lazy',
      },
      {
        path: RouteManager.path('notLazy'),
        Component: NotLazyPage,pathId: '@pages/not-lazy',
      },
      {
        Component: NotLazyPage,pathId: '@pages/not-lazy',
        path: RouteManager.path('notLazy'),
      },
      { Component: NotLazyPage,pathId: '@pages/not-lazy', path: RouteManager.path('notLazy') },
      { path: RouteManager.path('notLazy'), Component: NotLazyPage ,pathId: '@pages/not-lazy',},
    ],
  },
];

export default routes;
`;

const routesCode2Before = `
import type { TRouteObject } from '@lomray/vite-ssr-boost/interfaces/route-object';
import NotLazyPage from '@pages/not-lazy';
import RouteManager from '@services/route-manager';

/**
 * Application routes
 */
const routes: TRouteObject[] = [
  {
    path: RouteManager.path('notLazy'),
    element: <NotLazyPage />,
  },
  { path: RouteManager.path('notLazy'), element: <NotLazyPage />    },
  { element: <NotLazyPage /> },
  { element: <NotLazyPage />, path: RouteManager.path('notLazy')  },
  { Component: NotLazyPage  },
];

export default routes;
`;

const routesCode2After = `
import type { TRouteObject } from '@lomray/vite-ssr-boost/interfaces/route-object';
import NotLazyPage from '@pages/not-lazy';
import RouteManager from '@services/route-manager';

/**
 * Application routes
 */
const routes: TRouteObject[] = [
  {
    path: RouteManager.path('notLazy'),
    element: <NotLazyPage />,pathId: '@pages/not-lazy',
  },
  { path: RouteManager.path('notLazy'), element: <NotLazyPage />    ,pathId: '@pages/not-lazy',},
  { element: <NotLazyPage /> ,pathId: '@pages/not-lazy',},
  { element: <NotLazyPage />,pathId: '@pages/not-lazy', path: RouteManager.path('notLazy')  },
  { Component: NotLazyPage  ,pathId: '@pages/not-lazy',},
];

export default routes;
`;

const routesCode3Before = `
import NotLazyPage from '@pages/not-lazy';

/**
 * Application routes
 */
const routes: TRouteObject[] = [
  {
    element: <NotLazyPage />,
    path: RouteManager.path('notLazy'),
  },
  {path:RouteManager.path('notLazy'),Component:NotLazyPage},
  {Component:NotLazyPage,path:RouteManager.path('notLazy')},
];

export default routes;
`;

const routesCode3After = `
import NotLazyPage from '@pages/not-lazy';

/**
 * Application routes
 */
const routes: TRouteObject[] = [
  {
    element: <NotLazyPage />,pathId: '@pages/not-lazy',
    path: RouteManager.path('notLazy'),
  },
  {path:RouteManager.path('notLazy'),Component:NotLazyPage,pathId: '@pages/not-lazy',},
  {Component:NotLazyPage,pathId: '@pages/not-lazy',path:RouteManager.path('notLazy')},
];

export default routes;
`;

const routesCodeLazyBefore = `
import RouteManager from '@services/route-manager';

/**
 * Application routes
 */
const routes: TRouteObject[] = [
  {
    path: RouteManager.path('errorBoundary'),
    lazy: () => import('@pages/error-boundary'),
  },
];

export default routes;
`;

const routesCodeLazyAfter = `import n from '@lomray/vite-ssr-boost/helpers/import-route';
import RouteManager from '@services/route-manager';

/**
 * Application routes
 */
const routes: TRouteObject[] = [
  {
    path: RouteManager.path('errorBoundary'),
    lazy: ()=>n(() => import('@pages/error-boundary')),
  },
];

export default routes;
`;

const routesCode4Before = `
import type { TRouteObject } from '@lomray/vite-ssr-boost/interfaces/route-object';
import { lazy } from 'react';
import AppLayout from '@components/layouts/app';
import RouteManager from '@services/route-manager';

const GuestLayout = lazy(() => import('@components/layouts/guest'));

/**
 * Application routes
 */
const routes: TRouteObject[] = [
  {
    Component: AppLayout,
    children: [
      {
        Component: GuestLayout,
        children: [
          {
            path: RouteManager.path('signIn'),
            lazy: () => import('@pages/sign-in'),
          },
        ],
      },
    ],
  },
];

export default routes;
`;

const routesCode4After = `import n from '@lomray/vite-ssr-boost/helpers/import-route';
import type { TRouteObject } from '@lomray/vite-ssr-boost/interfaces/route-object';
import { lazy } from 'react';
import AppLayout from '@components/layouts/app';
import RouteManager from '@services/route-manager';

const GuestLayout = lazy(() => import('@components/layouts/guest'));

/**
 * Application routes
 */
const routes: TRouteObject[] = [
  {
    Component: AppLayout,pathId: '@components/layouts/app',
    children: [
      {
        Component: GuestLayout,
        children: [
          {
            path: RouteManager.path('signIn'),
            lazy: ()=>n(() => import('@pages/sign-in')),
          },
        ],
      },
    ],
  },
];

export default routes;
`;

export {
  routesCode1Before,
  routesCode1After,
  routesCode2Before,
  routesCode2After,
  routesCode3Before,
  routesCode3After,
  routesCode4Before,
  routesCode4After,
  routesCodeLazyBefore,
  routesCodeLazyAfter,
};
