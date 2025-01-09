import type { RouteObject } from 'react-router';
import type { IDynamicRoute } from '@helpers/import-route';

export type TRouteObjectNR = Omit<RouteObject, 'lazy' | 'children'> & {
  lazy?: IDynamicRoute | RouteObject['lazy'];
  isOnlyClient?: boolean; // render route only on client side
  children?: TRouteObject[];
};

export type TRouteObject = RouteObject | TRouteObjectNR;
