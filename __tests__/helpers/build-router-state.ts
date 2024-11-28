import { expect } from 'chai';
import type { StaticHandlerContext } from 'react-router';
import { describe, it } from 'vitest';
import buildRouterState from '@helpers/build-router-state';

describe('buildRouterState', () => {
  it('should build router state with valid context', () => {
    const context = {
      loaderData: { someData: 'loaderData' },
      actionData: { action: 'data' },
      errors: ['Test error'],
    } as unknown as StaticHandlerContext;

    const result = buildRouterState(context);

    expect(result).to.equal(
      '<script async>window.__staticRouterHydrationData = JSON.parse("{\\"loaderData\\":{\\"someData\\":\\"loaderData\\"},\\"actionData\\":{\\"action\\":\\"data\\"},\\"errors\\":{\\"0\\":\\"Test error\\"}}");</script>',
    );
  });

  it('should build router state with empty context', () => {
    const context = {} as unknown as StaticHandlerContext;
    const result = buildRouterState(context);

    expect(result).to.equal(
      '<script async>window.__staticRouterHydrationData = JSON.parse("{\\"errors\\":null}");</script>',
    );
  });

  it('should build router state with no errors', () => {
    const context = {
      loaderData: { someData: 'loaderData' },
      actionData: { action: 'data' },
    } as unknown as StaticHandlerContext;

    const result = buildRouterState(context);

    expect(result).to.equal(
      '<script async>window.__staticRouterHydrationData = JSON.parse("{\\"loaderData\\":{\\"someData\\":\\"loaderData\\"},\\"actionData\\":{\\"action\\":\\"data\\"},\\"errors\\":null}");</script>',
    );
  });
});
