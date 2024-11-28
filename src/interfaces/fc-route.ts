import type { FC, PropsWithChildren } from 'react';
import type { RouteObject } from 'react-router';
import type { FCC } from '@interfaces/fc';
import type { IRequestContext } from '@node/render';

declare module 'react-router' {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  export interface LoaderFunctionArgs {
    context?: IRequestContext;
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  export interface ActionFunctionArgs {
    context?: IRequestContext;
  }
}

const keys = ['loader', 'action', 'ErrorBoundary', 'errorElement'] as const;

type IRouteParams = Pick<RouteObject, (typeof keys)[number]> & {
  Suspense?: FCC<Record<string, any>>;
};

type FCRoute<TProps = Record<string, any>> = FC<TProps> & IRouteParams;
type FCCRoute<TProps = Record<string, any>> = FC<PropsWithChildren<TProps>> & IRouteParams;

export type { FCRoute, FCCRoute, IRouteParams };

export { keys };
