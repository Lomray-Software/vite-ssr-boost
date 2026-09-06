import { render, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { DataRouter } from 'react-router';
import sinon from 'sinon';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TApp } from '@browser/entry';
import entry from '@browser/entry';
import * as COMMON_CONSTANTS from '@constants/common';
import type { TRouteObject } from '@interfaces/route-object';

const routes: TRouteObject[] = [
  {
    path: '/',
    element: <div data-testid="home-page">Home</div>,
  },
];
const App: TApp<{ test: string }> = ({ children, client: { test = '' } = {} }) => (
  <div data-testid={`app-wrapper${test}`}>{children}</div>
);
const pageRoot = document.createElement('div');
const returnEntry = { isRoot: true };
const hydrationWindow = window as Window & {
  __staticRouterHydrationData?: Record<string, unknown>;
};

describe('browserEntry', () => {
  const sandbox = sinon.createSandbox();
  let readyStateDescriptor: PropertyDescriptor | undefined;
  let hydrationDescriptor: PropertyDescriptor | undefined;
  let getRootStub: sinon.SinonStub;

  beforeEach(() => {
    readyStateDescriptor = Object.getOwnPropertyDescriptor(document, 'readyState');
    hydrationDescriptor = Object.getOwnPropertyDescriptor(window, '__staticRouterHydrationData');
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    delete hydrationWindow.__staticRouterHydrationData;
    getRootStub = sandbox.stub(document, 'getElementById').returns(pageRoot);
  });

  afterEach(() => {
    sandbox.restore();
    cleanup();
    delete pageRoot.dataset['forceSpa'];
    if (readyStateDescriptor) {
      Object.defineProperty(document, 'readyState', readyStateDescriptor);
    } else {
      Reflect.deleteProperty(document, 'readyState');
    }
    if (hydrationDescriptor) {
      Object.defineProperty(window, '__staticRouterHydrationData', hydrationDescriptor);
    } else {
      delete hydrationWindow.__staticRouterHydrationData;
    }
  });

  it('should hydrate the app on the client side in SSR mode', async () => {
    sandbox.stub(COMMON_CONSTANTS, 'IS_SSR_MODE').value(true);

    const hydrateStub = sandbox.stub(ReactDOM, 'hydrateRoot').returns(returnEntry as never);

    const root = await entry(App, routes);

    const [argRoot, AppRoot] = hydrateStub.firstCall.args;
    const { getByTestId } = render(<div children={AppRoot} />);

    expect(getByTestId('home-page')).toBeDefined();
    expect(getByTestId('app-wrapper')).toBeDefined();
    expect(argRoot).to.equal(pageRoot);
    expect(root).to.equal(returnEntry);
  });

  it('should render the app on the client side', async () => {
    sandbox.stub(COMMON_CONSTANTS, 'IS_SSR_MODE').value(false);

    const renderStub = sandbox.stub().returns(returnEntry);
    const createRootStub = sandbox.stub(ReactDOM, 'createRoot').returns({
      render: renderStub,
      unmount: sandbox.stub(),
    });

    const root = await entry(App, routes);

    const [AppRoot] = renderStub.firstCall.args as [ReactNode];
    const { getByTestId } = render(<div children={AppRoot} />);

    expect(getByTestId('home-page')).toBeDefined();
    expect(createRootStub.calledOnceWith(pageRoot)).toBe(true);
    expect(root).to.equal(returnEntry);
  });

  it('should call init with routes and params', async () => {
    sandbox.stub(COMMON_CONSTANTS, 'IS_SSR_MODE').value(true);

    const hydrateStub = sandbox.stub(ReactDOM, 'hydrateRoot');
    const initStub = sandbox.stub().returns({ test: '-init-arg' });

    await entry(App, routes, { init: initStub });

    const { isSSRMode, router } = initStub.firstCall.firstArg as {
      isSSRMode: boolean;
      router: DataRouter;
    };
    const [, AppRoot] = hydrateStub.firstCall.args;
    const { getByTestId } = render(<div children={AppRoot} />);

    expect(getByTestId('app-wrapper-init-arg')).toBeDefined();
    expect(isSSRMode).toBe(true);
    expect(router.routes[0].path).to.equal('/');
  });

  it('should load lazy matches and update routes before creating the router', async () => {
    sandbox.stub(window, 'location').value({ pathname: '/lazy' });
    sandbox.stub(ReactDOM, 'hydrateRoot');

    const localRoutes: TRouteObject[] = [
      {
        path: '/lazy',
        // @ts-ignore
        lazy: () =>
          Promise.resolve({
            default: () => <div data-testid="lazy-page">Lazy</div>,
          }),
      },
    ];

    await entry(App, localRoutes);

    expect(localRoutes[0].lazy).toBeUndefined();
    expect(typeof (localRoutes[0] as Record<string, unknown>).default).toBe('function');
  });

  it('waits for serialized state before reading the root, creating the router or hydrating', async () => {
    sandbox.stub(COMMON_CONSTANTS, 'IS_SSR_MODE').value(true);
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    const state = { loaderData: { root: ['one', 'two', 'three'] } };
    const createRouter = sandbox.stub().callsFake(() => {
      expect(hydrationWindow.__staticRouterHydrationData).toBe(state);
      return {} as DataRouter;
    });
    const hydrateStub = sandbox.stub(ReactDOM, 'hydrateRoot').returns(returnEntry as never);
    const init = sandbox.stub();
    const pending = entry(App, routes, { createRouter, init });

    await Promise.resolve();
    expect(hydrationWindow.__staticRouterHydrationData).toBeUndefined();
    expect(getRootStub.called).toBe(false);
    expect(createRouter.called).toBe(false);
    expect(init.called).toBe(false);
    expect(hydrateStub.called).toBe(false);

    hydrationWindow.__staticRouterHydrationData = state;

    expect(Object.getOwnPropertyDescriptor(window, '__staticRouterHydrationData')).toEqual({
      configurable: true,
      enumerable: true,
      writable: true,
      value: state,
    });
    expect(await pending).toBe(returnEntry);
    expect(createRouter.calledOnceWith(routes, undefined)).toBe(true);
    expect(getRootStub.calledOnceWith('root')).toBe(true);
    expect(init.calledOnce).toBe(true);
    expect(hydrateStub.calledOnce).toBe(true);

    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(hydrationWindow.__staticRouterHydrationData).toBeUndefined();
    hydrationWindow.__staticRouterHydrationData = { loaderData: {} };
    expect(hydrationWindow.__staticRouterHydrationData).toEqual({ loaderData: {} });
    expect(createRouter.calledOnce).toBe(true);
  });

  it('falls back to DOMContentLoaded when no state is assigned', async () => {
    sandbox.stub(COMMON_CONSTANTS, 'IS_SSR_MODE').value(true);
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    const createRouter = sandbox.stub().returns({} as DataRouter);
    const hydrateStub = sandbox.stub(ReactDOM, 'hydrateRoot');
    const pending = entry(App, routes, { createRouter });

    await Promise.resolve();
    expect(getRootStub.called).toBe(false);
    expect(createRouter.called).toBe(false);
    expect(hydrateStub.called).toBe(false);

    document.dispatchEvent(new Event('DOMContentLoaded'));
    await pending;

    expect(createRouter.calledOnce).toBe(true);
    expect(hydrateStub.calledOnce).toBe(true);
    expect(Object.getOwnPropertyDescriptor(window, '__staticRouterHydrationData')).toBeUndefined();
  });

  it.each(['interactive', 'complete'])(
    'creates the router immediately when the document is %s',
    async (readyState) => {
      sandbox.stub(COMMON_CONSTANTS, 'IS_SSR_MODE').value(true);
      Object.defineProperty(document, 'readyState', { value: readyState, configurable: true });
      const createRouter = sandbox.stub().returns({} as DataRouter);
      const hydrateStub = sandbox.stub(ReactDOM, 'hydrateRoot');
      const pending = entry(App, routes, { createRouter });

      expect(createRouter.calledOnce).toBe(true);
      expect(getRootStub.calledOnce).toBe(true);
      expect(
        Object.getOwnPropertyDescriptor(window, '__staticRouterHydrationData'),
      ).toBeUndefined();
      await pending;
      expect(hydrateStub.calledOnce).toBe(true);
    },
  );

  it('continues immediately when serialized state is already defined', async () => {
    sandbox.stub(COMMON_CONSTANTS, 'IS_SSR_MODE').value(true);
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    hydrationWindow.__staticRouterHydrationData = { loaderData: {} };
    const descriptor = Object.getOwnPropertyDescriptor(window, '__staticRouterHydrationData');
    const createRouter = sandbox.stub().returns({} as DataRouter);
    const hydrateStub = sandbox.stub(ReactDOM, 'hydrateRoot');
    const pending = entry(App, routes, { createRouter });

    expect(createRouter.calledOnce).toBe(true);
    expect(Object.getOwnPropertyDescriptor(window, '__staticRouterHydrationData')).toBeUndefined();
    await pending;
    expect(hydrateStub.calledOnce).toBe(true);
  });

  it.each([false, true])(
    'waits for DOMContentLoaded before mounting SPA output with SSR mode %s',
    async (isSSRMode) => {
      sandbox.stub(COMMON_CONSTANTS, 'IS_SSR_MODE').value(isSSRMode);
      Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
      if (isSSRMode) {
        pageRoot.dataset['forceSpa'] = '1';
      }
      const createRouter = sandbox.stub().returns({} as DataRouter);
      const renderStub = sandbox.stub().returns(returnEntry);
      const createRootStub = sandbox.stub(ReactDOM, 'createRoot').returns({
        render: renderStub,
        unmount: sandbox.stub(),
      });
      const hydrateStub = sandbox.stub(ReactDOM, 'hydrateRoot');
      const pending = entry(App, routes, { createRouter });

      if (!isSSRMode) {
        expect(
          Object.getOwnPropertyDescriptor(window, '__staticRouterHydrationData'),
        ).toBeUndefined();
        hydrationWindow.__staticRouterHydrationData = { loaderData: {} };
      }
      await Promise.resolve();
      expect(getRootStub.called).toBe(false);
      expect(createRouter.called).toBe(false);
      expect(createRootStub.called).toBe(false);

      document.dispatchEvent(new Event('DOMContentLoaded'));

      expect(await pending).toBe(returnEntry);
      expect(createRouter.calledOnce).toBe(true);
      expect(createRootStub.calledOnceWith(pageRoot)).toBe(true);
      expect(renderStub.calledOnce).toBe(true);
      expect(hydrateStub.called).toBe(false);
    },
  );

  it.each(['state', 'lazy route'])(
    'preloads lazy routes in parallel and waits for both when %s arrives first',
    async (first) => {
      sandbox.stub(COMMON_CONSTANTS, 'IS_SSR_MODE').value(true);
      Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
      let resolveLazy!: (value: { Component: () => null }) => void;
      const lazy = sandbox.stub().returns(
        new Promise<{ Component: () => null }>((resolve) => {
          resolveLazy = resolve;
        }),
      );
      const Component = () => null;
      const localRoutes: TRouteObject[] = [{ path: '/', lazy }];
      const createRouter = sandbox.stub().returns({} as DataRouter);
      const hydrateStub = sandbox.stub(ReactDOM, 'hydrateRoot');
      const pending = entry(App, localRoutes, { createRouter });

      expect(lazy.calledOnce).toBe(true);
      expect(createRouter.called).toBe(false);

      if (first === 'state') {
        hydrationWindow.__staticRouterHydrationData = { loaderData: {} };
      } else {
        resolveLazy({ Component });
      }
      await Promise.resolve();
      expect(createRouter.called).toBe(false);
      expect(getRootStub.called).toBe(false);
      expect(hydrateStub.called).toBe(false);

      if (first === 'state') {
        resolveLazy({ Component });
      } else {
        expect(localRoutes[0].lazy).toBeUndefined();
        hydrationWindow.__staticRouterHydrationData = { loaderData: {} };
      }
      await pending;

      expect(localRoutes[0].lazy).toBeUndefined();
      expect(localRoutes[0].Component).toBe(Component);
      expect(createRouter.calledOnceWith(localRoutes, undefined)).toBe(true);
      expect(hydrateStub.calledOnce).toBe(true);
    },
  );
});
