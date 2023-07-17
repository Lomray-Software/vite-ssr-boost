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
 * Assign route path id to component
 */
const assignId = (response: Record<string, any>, id?: string) => {
  if (!id) {
    return;
  }

  response['pathId'] = id;
};

/**
 * Import dynamic route
 */
const importRoute = async (route: IDynamicRoute, id?: string): Promise<IAsyncRoute> => {
  const resolved = await route();

  // fallback to react router export style
  if (resolved['Component']) {
    assignId(resolved, id);

    return resolved as IAsyncRoute;
  }

  const Component = resolved.default;
  const result = { Component };

  keys.forEach((key) => {
    if (Component[key]) {
      result[key] = Component[key];
    }
  });

  if (Component.Suspense) {
    result.Component = withSuspense(Component, Component.Suspense);
  }

  assignId(result, id);

  return result;
};

export default importRoute;
