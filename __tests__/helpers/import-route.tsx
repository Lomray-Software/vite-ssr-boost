import { render } from '@testing-library/react';
import { expect } from 'chai';
import React from 'react';
import sinon from 'sinon';
import { afterEach, describe, it } from 'vitest';
import * as COMMON_CONSTANTS from '@constants/common';
import type { IDynamicRoute } from '@helpers/import-route';
import importRoute from '@helpers/import-route';
import type { FCRoute } from '@interfaces/fc-route';
import { keys } from '@interfaces/fc-route';

describe('importRoute', () => {
  const sandbox = sinon.createSandbox();

  const Component = (() => 'Test') as unknown as FCRoute;
  const getDynamicRoute = (props: Record<string, any> = {}, isDefaultExport = false) =>
    (() =>
      Promise.resolve(
        isDefaultExport ? { default: { Component, ...props } } : { Component, ...props },
      )) as unknown as IDynamicRoute;

  afterEach(() => {
    sandbox.restore();
  });

  it('should import dynamic route and return an IAsyncRoute object with Component', async () => {
    const result = await importRoute(getDynamicRoute())();

    expect(result.Component).to.be.a('function');
    expect(result.Component).to.equal(Component);
  });

  it('should handle dynamic route with additional properties', async () => {
    const result = await importRoute(getDynamicRoute({ someProp: 'value' }))();

    expect(result.Component).to.be.a('function');
    expect(result).to.have.property('someProp').and.to.equal('value');
  });

  it('should handle dynamic route with Suspense and wrap Component with withSuspense', async () => {
    const result = await importRoute(
      getDynamicRoute(
        {
          Suspense: () => null,
        },
        true,
      ),
    )();

    expect(result.Component).to.be.a('function');
    expect(result.Component).to.not.equal(Component);
    expect(result).to.not.have.property('Suspense');
  });

  it('should handle dynamic route with other keys and copy them to the result', async () => {
    const allowedKeys = keys.reduce((res, key) => ({ ...res, [key]: key }), {});

    const result = await importRoute(
      getDynamicRoute(
        {
          ...allowedKeys,
          notAllowedKey: 'value1',
        },
        true,
      ),
    )();

    expect(result.Component).to.not.undefined;
    expect(result).to.not.have.property('notAllowedKey');
    Object.entries(allowedKeys).forEach(([key, value]) => {
      expect(result).to.have.property(key).and.to.equal(value);
    });
  });

  it('should return empty element for client only rendering', async () => {
    sandbox.stub(COMMON_CONSTANTS, 'IS_SERVER').value(true);

    const result = await importRoute(getDynamicRoute(), true)();

    expect(result.element).to.equal(null);
  });

  it('should handle dynamic route wrap Component with renderClient', async () => {
    const result = await importRoute(getDynamicRoute(), true)();
    const ClientComponent = result.Component!;

    const { container } = render(<ClientComponent />);

    expect(container.textContent).to.equal('Test');
  });
});
