import { expect } from 'chai';
import type { StaticHandlerContext } from 'react-router-dom/server';
import { describe, it } from 'vitest';
import buildRouterState from '@helpers/build-router-state';

const dataScript = '<script async>window.__staticRouterHydrationData = ';

describe('buildRouterState', () => {
  it('should build router state with valid context', () => {
    const context = {
      loaderData: { someData: 'loaderData' },
      actionData: { action: 'data' },
      errors: ['Test error'],
    } as unknown as StaticHandlerContext;

    const result = buildRouterState(context);
    const expectedJson = JSON.stringify({
      loaderData: context.loaderData,
      actionData: context.actionData,
      errors: { 0: 'Test error' },
    });

    expect(result).to.include(dataScript);
    expect(result).to.include(expectedJson);
    expect(result).to.include('</script>');
  });

  it('should build router state with empty context', () => {
    const context = {} as unknown as StaticHandlerContext;

    const result = buildRouterState(context);
    const expectedJson = JSON.stringify({
      loaderData: undefined,
      actionData: undefined,
      errors: null,
    });

    expect(result).to.include(dataScript);
    expect(result).to.include(expectedJson);
    expect(result).to.include('</script>');
  });

  it('should build router state with no errors', () => {
    const context = {
      loaderData: { someData: 'loaderData' },
      actionData: { action: 'data' },
    } as unknown as StaticHandlerContext;

    const result = buildRouterState(context);
    const expectedJson = JSON.stringify({
      loaderData: context.loaderData,
      actionData: context.actionData,
      errors: null,
    });

    expect(result).to.include(dataScript);
    expect(result).to.include(expectedJson);
    expect(result).to.include('</script>');
  });
});
