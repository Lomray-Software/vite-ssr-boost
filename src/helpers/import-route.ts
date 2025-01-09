import type { IndexRouteObject, NonIndexRouteObject } from 'react-router';
import renderClient from '@components/render-client';
import withSuspense from '@components/with-suspense';
import { IS_SERVER } from '@constants/common';
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
const importRoute = (route: IDynamicRoute, isOnlyClient = false): (() => Promise<IAsyncRoute>) => {
  return async (): Promise<IAsyncRoute> => {
    if (isOnlyClient && IS_SERVER) {
      return { element: null };
    }

    const resolved = await route();

    // fallback to react router export style
    if ('Component' in resolved) {
      const Component = isOnlyClient
        ? renderClient(resolved.Component as FCRoute | FCCRoute<any>)
        : resolved.Component;

      return { ...resolved, Component } as IAsyncRoute;
    }

    const Component = resolved.default;
    const result: IAsyncRoute = { Component };

    keys.forEach((key) => {
      if (Component[key]) {
        // @ts-ignore
        result[key] = Component[key] as NonNullable<IAsyncRoute[typeof key]>;
      }
    });

    if (Component.Suspense) {
      result.Component = withSuspense(Component, Component.Suspense);
    }

    if (isOnlyClient) {
      result.Component = renderClient(result.Component as FCRoute | FCCRoute<any>);
    }

    return result;
  };
};

export default importRoute;
