import { render, waitFor } from '@testing-library/react';
import React, { Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import sinon from 'sinon';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import OnlyClient from '@components/only-client';

describe('OnlyClient', () => {
  const sandbox = sinon.createSandbox();
  const mockLoad = () => Promise.resolve({ default: () => <div>Loaded Component</div> });
  const MockFallback = () => <div>Fallback Component</div>;
  const MockErrorComponent = () => <div>Error Component</div>;

  beforeAll(() => {
    sandbox.stub(console, 'error');
  });

  afterAll(() => {
    sandbox.restore();
  });

  it('should render loaded component', async () => {
    const { getByText } = render(
      <Suspense fallback={<div>Loading...</div>}>
        <OnlyClient load={mockLoad}>{(Component) => <Component />}</OnlyClient>
      </Suspense>,
    );

    await waitFor(() => expect(getByText('Loaded Component')).to.exist);
  });

  it('should render fallback component while loading', async () => {
    const { getByText } = render(
      <Suspense fallback={<div>Loading...</div>}>
        <OnlyClient
          load={mockLoad}
          fallback={<MockFallback />}
          errorComponent={<MockErrorComponent />}
        >
          {(Component) => <Component />}
        </OnlyClient>
      </Suspense>,
    );

    expect(getByText('Fallback Component')).to.exist;
    await waitFor(() => expect(getByText('Loaded Component')).to.exist);
  });

  it('should render error component if loading fails', async () => {
    const mockLoadWithError = () => Promise.reject(new Error('Load Error'));
    const { getByText } = render(
      <Suspense fallback={<div>Loading...</div>}>
        <OnlyClient
          load={mockLoadWithError}
          fallback={<MockFallback />}
          errorComponent={<MockErrorComponent />}
        >
          {(Component) => <Component />}
        </OnlyClient>
      </Suspense>,
    );

    await waitFor(() => expect(getByText('Error Component')).to.exist);
  });

  it('should not render anything on server or render fallback', () => {
    const html = renderToString(
      <OnlyClient
        load={mockLoad}
        fallback={<MockFallback />}
        errorComponent={<MockErrorComponent />}
      >
        {(Component) => <Component />}
      </OnlyClient>,
    );

    expect(html).toBe('<div>Fallback Component</div>');
  });
});
