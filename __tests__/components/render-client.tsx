import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import renderClient from '@components/render-client';

describe('renderClient', () => {
  it('should render component after mount', async () => {
    const Component = ({ text }: { text: string }) => <div>{text}</div>;
    const ClientComponent = renderClient(Component);
    const { container } = render(<ClientComponent text="client-ready" />);

    await waitFor(() => {
      expect(container.textContent).toBe('client-ready');
    });
  });

  it('should render fallback element on server render', () => {
    const Component = () => <div>client-ready</div>;
    const ClientComponent = renderClient(Component, {
      element: <div>loading</div>,
    });
    const html = renderToString(<ClientComponent />);

    expect(html).toBe('<div>loading</div>');
  });

  it('should render fallback component on server render', () => {
    const Component = () => <div>client-ready</div>;
    const Fallback = () => <div>fallback-component</div>;
    const ClientComponent = renderClient(Component, { Component: Fallback });
    const html = renderToString(<ClientComponent />);

    expect(html).toBe('<div>fallback-component</div>');
  });

  it('should preserve static properties', () => {
    const Component = (() => <div>client-ready</div>) as React.FC & { staticMethod?: string };

    Component.staticMethod = 'preserved';

    const ClientComponent = renderClient(Component);

    expect(
      (ClientComponent as typeof ClientComponent & { staticMethod?: string }).staticMethod,
    ).toBe('preserved');
  });

  it('should return null when component and fallback are not provided', () => {
    const ClientComponent = renderClient(null);
    const html = renderToString(<ClientComponent />);

    expect(html).toBe('');
  });
});
