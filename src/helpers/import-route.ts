import type { FC, ReactNode } from 'react';
import { isValidElement } from 'react';
import type { IndexRouteObject, NonIndexRouteObject } from 'react-router';
import renderClient from '@components/render-client';
import withSuspense from '@components/with-suspense';
import { IS_SERVER } from '@constants/common';
import type { FCCRoute, FCRoute } from '@interfaces/fc-route';
import { keys } from '@interfaces/fc-route';
import type { TOnlyClientProp } from '@interfaces/route-object';

export type IDynamicRoute = () => Promise<{ default: FCRoute | FCCRoute<any> }>;

export type ImmutableRouteKey = 'lazy' | 'caseSensitive' | 'path' | 'id' | 'index' | 'children';

export type IAsyncRoute = { pathId?: string } & (
  | Omit<IndexRouteObject, ImmutableRouteKey>
  | Omit<NonIndexRouteObject, ImmutableRouteKey>
);

/**
 * Return right fallback syntax
 */
const getFallback = (
  Fallback?: TOnlyClientProp,
): { element: ReactNode } | { Component: FC | null } => {
  if (isValidElement(Fallback)) {
    return { element: Fallback };
  }

  if ((typeof Fallback === 'function' || typeof Fallback === 'object') && Fallback !== null) {
    return { Component: Fallback as FC };
  }

  return { Component: null };
};

/**
 * Import dynamic route
 */
const importRoute = (
  route: IDynamicRoute,
  onlyClient?: TOnlyClientProp,
): (() => Promise<IAsyncRoute>) => {
  return async (): Promise<IAsyncRoute> => {
    const Fallback = getFallback(onlyClient);

    if (onlyClient && IS_SERVER) {
      return Fallback;
    }

    const resolved = await route();

    // fallback to react router export style
    if ('Component' in resolved) {
      const Component = onlyClient
        ? renderClient(resolved.Component as FCRoute | FCCRoute<any>, Fallback)
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

    if (onlyClient) {
      result.Component = renderClient(result.Component as FCRoute | FCCRoute<any>, Fallback);
    }

    return result;
  };
};

export default importRoute;
