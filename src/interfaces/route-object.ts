import type { RouteObject } from 'react-router';
import type { IDynamicRoute } from '@helpers/import-route';

export type TOnlyClientProp = RouteObject['Component'] | RouteObject['element'];

export type TRouteObjectNR = Omit<RouteObject, 'lazy' | 'children'> & {
  lazy?: IDynamicRoute | RouteObject['lazy'];
  // render route only on client side
  onlyClient?: TOnlyClientProp;
  children?: TRouteObject[];
};

export type TRouteObject = RouteObject | TRouteObjectNR;
