import { render, act, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import type { RouteObject } from 'react-router';
import { Outlet, createBrowserRouter, Link, RouterProvider } from 'react-router';
import sinon from 'sinon';
import { describe, it, expect, afterEach } from 'vitest';
import ScrollToTop from '@components/scroll-to-top';

describe('ScrollToTop Component', () => {
  const sandbox = sinon.createSandbox();
  const routes: RouteObject[] = [
    {
      index: true,
      element: (
        <div>
          <Link to="/page2" data-testid="go-page-2">
            Go to page 2
          </Link>
          <Link to="/?test=1" data-testid="go-page-1">
            Go to page 1
          </Link>
        </div>
      ),
    },
    {
      path: '/page2',
      element: <div>Page 2</div>,
    },
  ];

  afterEach(() => {
    sandbox.restore();
    // reset location
    // @ts-ignore
    window.location = new URL('http://localhost:3000/');
  });

  it('scrolls to top when pathname changes', () => {
    const mockScroll = sandbox.stub();

    sandbox.stub(window, 'scrollTo').value(mockScroll);

    const { container } = render(
      <RouterProvider
        router={createBrowserRouter([
          {
            element: (
              <>
                <ScrollToTop />
                <Outlet />
              </>
            ),
            children: routes,
          },
        ])}
      />,
    );

    act(() => {
      fireEvent.click(screen.getByTestId('go-page-2'));
    });

    expect(container.textContent).to.equal('Page 2');
    expect(mockScroll).to.calledOnceWith(0, 0);
  });

  it('does not scroll to top if shouldReloadReset is false and pathname does not change', () => {
    const mockScroll = sandbox.stub();

    sandbox.stub(window, 'scrollTo').value(mockScroll);

    const { container } = render(
      <RouterProvider
        router={createBrowserRouter([
          {
            element: (
              <>
                <ScrollToTop shouldReloadReset={false} />
                <Outlet />
              </>
            ),
            children: routes,
          },
        ])}
      />,
    );

    act(() => {
      fireEvent.click(screen.getByTestId('go-page-1'));
    });

    expect(container.textContent).to.contain('Go to page 2');
    expect(mockScroll).to.not.called;
  });
});
