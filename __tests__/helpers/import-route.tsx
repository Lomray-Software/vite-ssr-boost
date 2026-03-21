import { render } from '@testing-library/react';
import React from 'react';
import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
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

    expect(result.Component).toBeTypeOf('function');
    expect(result.Component).to.equal(Component);
  });

  it('should handle dynamic route with additional properties', async () => {
    const result = await importRoute(getDynamicRoute({ someProp: 'value' }))();

    expect(result.Component).toBeTypeOf('function');
    expect(result).toHaveProperty('someProp', 'value');
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

    expect(result.Component).toBeTypeOf('function');
    expect(result.Component).to.not.equal(Component);
    expect(result).not.toHaveProperty('Suspense');
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

    expect(result.Component).toBeDefined();
    expect(result).not.toHaveProperty('notAllowedKey');
    Object.entries(allowedKeys).forEach(([key, value]) => {
      expect(result).toHaveProperty(key, value);
    });
  });

  it('should return empty element for client only rendering', async () => {
    sandbox.stub(COMMON_CONSTANTS, 'IS_SERVER').value(true);

    const result = await importRoute(getDynamicRoute(), true)();

    expect(result.Component).to.equal(null);
  });

  it('should return Fallback component for client only rendering', async () => {
    sandbox.stub(COMMON_CONSTANTS, 'IS_SERVER').value(true);

    const Fallback = () => null;
    const result = await importRoute(getDynamicRoute(), Fallback)();

    expect(result.Component).to.equal(Fallback);
  });

  it('should handle dynamic route wrap Component with renderClient', async () => {
    const result = await importRoute(getDynamicRoute(), true)();
    const ClientComponent = result.Component!;

    const { container } = render(<ClientComponent />);

    expect(container.textContent).to.equal('Test');
  });
});
