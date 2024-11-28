import { render } from '@testing-library/react';
import React from 'react';
import { createBrowserRouter, MemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import Navigate from '@components/navigate';
import { ServerContext } from '@context/server';

describe('Navigate Component', () => {
  it('should render default Navigate component on client side', () => {
    const router = createBrowserRouter([
      {
        index: true,
        element: <Navigate to="/path" />,
      },
      {
        path: '/path',
        element: <div>Worked!</div>,
      },
    ]);

    const { container } = render(<RouterProvider router={router} />);

    expect(container.firstChild?.textContent).to.equal('Worked!');
  });

  it('should update server response when rendered on server side', () => {
    const mockServerContext: { isServer: boolean; response: Response | null } = {
      isServer: true,
      response: null,
    };

    render(
      <MemoryRouter>
        <ServerContext.Provider value={mockServerContext}>
          <Navigate to="/path" status={305} />
        </ServerContext.Provider>
      </MemoryRouter>,
    );

    expect(mockServerContext.response?.status).to.equal(305);
    expect(mockServerContext.response?.headers.get('location')).to.equal('/path');
  });
});
