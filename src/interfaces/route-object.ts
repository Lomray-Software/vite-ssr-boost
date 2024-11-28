import type { RouteObject } from 'react-router';
import type { IDynamicRoute } from '@helpers/import-route';

export type TRouteObjectNR = Omit<RouteObject, 'lazy' | 'children'> & {
  lazy?: IDynamicRoute | RouteObject['lazy'];
  children?: TRouteObject[];
};

export type TRouteObject = RouteObject | TRouteObjectNR;
