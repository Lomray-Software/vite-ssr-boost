import { render } from '@testing-library/react';
import type { FC } from 'react';
import React from 'react';
import { describe, it, expect } from 'vitest';
import withSuspense from '@components/with-suspense';
import type { FCC } from '@interfaces/fc';

describe('withSuspense', () => {
  const FakeSuspense: FCC<Record<string, any>> = ({ children }) => (
    <div>
      <span>SUSPENSE:</span>
      {children}
    </div>
  );
  const FakeComponent: FC<{ testProp?: string }> = ({ testProp }) => (
    <div>COMPONENT:{testProp}</div>
  );

  // @ts-ignore
  FakeComponent['staticMethod'] = 'static';

  it('renders the component wrapped with Suspense', () => {
    const WrappedComponent = withSuspense(FakeComponent, FakeSuspense);

    const { container } = render(<WrappedComponent />);

    expect(container.textContent).to.equal('SUSPENSE:COMPONENT:');
  });

  it('passes props to the wrapped component', () => {
    const WrappedComponent = withSuspense(FakeComponent, FakeSuspense);

    const { container } = render(<WrappedComponent testProp="test-prop" />);

    expect(container.textContent).to.equal('SUSPENSE:COMPONENT:test-prop');
  });

  it('passes keep static props of original component', () => {
    const WrappedComponent = withSuspense(FakeComponent, FakeSuspense);

    expect(WrappedComponent).to.have.property('staticMethod').and.to.equal('static');
  });
});
