import type { IndexRouteObject, NonIndexRouteObject } from 'react-router';
import withSuspense from '@components/with-suspense';
import type { FCCRoute, FCRoute } from '@interfaces/fc-route';
import { keys } from '@interfaces/fc-route';

export type IDynamicRoute = () => Promise<{ default: FCRoute | FCCRoute<any> }>;

export type ImmutableRouteKey = 'lazy' | 'caseSensitive' | 'path' | 'id' | 'index' | 'children';

export type IAsyncRoute = { pathId?: string } & (
  | Omit<IndexRouteObject, ImmutableRouteKey>
  | Omit<NonIndexRouteObject, ImmutableRouteKey>
);

/**
 * Import dynamic route
 */
const importRoute = (route: IDynamicRoute, id?: string): (() => Promise<IAsyncRoute>) => {
  return async (): Promise<IAsyncRoute> => {
    const resolved = await route();

    // fallback to react router export style
    if ('Component' in resolved) {
      return { ...resolved, pathId: id } as IAsyncRoute;
    }

    const Component = resolved.default;
    const result: IAsyncRoute = { Component, pathId: id };

    keys.forEach((key) => {
      if (Component[key]) {
        // @ts-ignore
        result[key] = Component[key] as NonNullable<IAsyncRoute[typeof key]>;
      }
    });

    if (Component.Suspense) {
      result.Component = withSuspense(Component, Component.Suspense);
    }

    return result;
  };
};

export default importRoute;
