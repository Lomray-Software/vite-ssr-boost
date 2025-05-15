import type { RouteObject, LazyRouteFunction, RouterInit } from 'react-router';
import type { IDynamicRoute } from '@helpers/import-route';

type LazyRoute = LazyRouteFunction<RouterInit['routes'][number]>;

export type TOnlyClientProp = RouteObject['Component'] | RouteObject['element'];

export type TRouteObjectNR = Omit<RouteObject, 'lazy' | 'children'> & {
  lazy?: IDynamicRoute | LazyRoute;
  // render route only on client side
  onlyClient?: TOnlyClientProp;
  children?: TRouteObject[];
};

export type TRouteObject = (Omit<RouteObject, 'lazy'> & { lazy: LazyRoute }) | TRouteObjectNR;
