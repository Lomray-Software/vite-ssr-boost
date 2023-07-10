import type { RouteObject } from 'react-router-dom';
import type { IDynamicRoute } from '@helpers/import-route';

export type TRouteObjectNR = Omit<RouteObject, 'lazy' | 'children'> & {
  lazyNR?: IDynamicRoute;
  children?: TRouteObject[];
};

export type TRouteObject = RouteObject | TRouteObjectNR;
