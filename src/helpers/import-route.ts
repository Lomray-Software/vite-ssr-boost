import type { ImmutableRouteKey } from '@remix-run/router/utils';
import type { IndexRouteObject, NonIndexRouteObject } from 'react-router-dom';
import withSuspense from '@components/with-suspense';
import type { FCCRoute, FCRoute } from '@interfaces/fc-route';
import { keys } from '@interfaces/fc-route';

export type IDynamicRoute = () => Promise<{ default: FCRoute | FCCRoute<any> }>;

export type IAsyncRoute =
  | Omit<IndexRouteObject, ImmutableRouteKey>
  | Omit<NonIndexRouteObject, ImmutableRouteKey>;

/**
 * Import dynamic route
 */
const importRoute = async (route: IDynamicRoute): Promise<IAsyncRoute> => {
  const Component = (await route()).default;
  const result = { Component };

  keys.forEach((key) => {
    if (Component[key]) {
      result[key] = Component[key];
    }
  });

  if (Component.Suspense) {
    result.Component = withSuspense(Component, Component.Suspense);
  }

  return result;
};

export default importRoute;
