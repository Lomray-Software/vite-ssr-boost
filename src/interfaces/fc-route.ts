import type { FC, PropsWithChildren } from 'react';
import type { RouteObject } from 'react-router/dist/lib/context';

const keys = ['loader', 'action', 'ErrorBoundary', 'errorElement'] as const;

type IRouteParams = Pick<RouteObject, (typeof keys)[number]> & { Suspense?: FC };

type FCRoute<TProps = Record<string, any>> = FC<TProps> & IRouteParams;
type FCCRoute<TProps = Record<string, any>> = FC<PropsWithChildren<TProps>> & IRouteParams;

export type { FCRoute, FCCRoute, IRouteParams };

export { keys };
