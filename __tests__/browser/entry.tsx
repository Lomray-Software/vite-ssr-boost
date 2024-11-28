import { render, cleanup } from '@testing-library/react';
import { expect } from 'chai';
import type { ReactNode } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { DataRouter, RouteObject } from 'react-router';
import sinon from 'sinon';
import { afterEach, beforeEach, describe, it } from 'vitest';
import type { TApp } from '@browser/entry';
import entry from '@browser/entry';
import * as COMMON_CONSTANTS from '@constants/common';

const routes: RouteObject[] = [
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

describe('browserEntry', () => {
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    sandbox.stub(document, 'getElementById').returns(pageRoot);
  });

  afterEach(() => {
    sandbox.restore();
    cleanup();
  });

  it('should hydrate the app on the client side in SSR mode', async () => {
    sandbox.stub(COMMON_CONSTANTS, 'IS_SSR_MODE').value(true);

    const hydrateStub = sandbox.stub(ReactDOM, 'hydrateRoot').returns(returnEntry as never);

    const root = await entry(App, routes);

    const [argRoot, AppRoot] = hydrateStub.firstCall.args;
    const { getByTestId } = render(<div children={AppRoot} />);

    expect(getByTestId('home-page')).to.not.undefined;
    expect(getByTestId('app-wrapper')).to.not.undefined;
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

    expect(getByTestId('home-page')).to.not.undefined;
    expect(createRootStub).to.calledOnceWith(pageRoot);
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

    expect(getByTestId('app-wrapper-init-arg')).to.not.undefined;
    expect(isSSRMode).to.true;
    expect(router.routes[0].path).to.equal('/');
  });

  it('should load lazy matches and update routes before creating the router', async () => {
    sandbox.stub(window, 'location').value({ pathname: '/lazy' });
    sandbox.stub(ReactDOM, 'hydrateRoot');

    const localRoutes: RouteObject[] = [
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

    expect(localRoutes[0].lazy).to.be.undefined;
    expect(localRoutes[0]).to.have.property('default').and.a('function');
  });
});
