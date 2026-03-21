import { describe, expect, it } from 'vitest';
import { routesCodeLazyBefore, routesCode2Before, routesCode3Before } from '@__mocks__/route-file';
import isRoutesFile from '@helpers/is-route-file';

describe('isRoutesFile', () => {
  it('should return true if code contains path and lazy import', () => {
    expect(isRoutesFile(routesCodeLazyBefore)).toBe(true);
  });

  it('should return true if code contains path and Component', () => {
    expect(isRoutesFile(routesCode3Before)).toBe(true);
  });

  it('should return true if code contains path and element', () => {
    expect(isRoutesFile(routesCode2Before)).toBe(true);
  });

  it('should return false if code does not contain path', () => {
    const code = `
      {
        Component: ExampleComponent,
      }
    `;

    expect(isRoutesFile(code)).toBe(false);
  });

  it('should return false if code does not contain path, lazy import, Component, or element', () => {
    const code = `
      {
        someKey: 'someValue',
      }
    `;

    expect(isRoutesFile(code)).toBe(false);
  });

  it('should return true if code contains path, lazy import, and additional keys', () => {
    const code = `
      {
        path: '/example',
        lazy: () => import('./Example'),
        someKey: 'someValue',
      }
    `;

    expect(isRoutesFile(code)).toBe(true);
  });

  it('should return true if code contains path, Component, and additional keys', () => {
    const code = `
      {
        path: '/example',
        Component: ExampleComponent,
        someKey: 'someValue',
      }
    `;

    expect(isRoutesFile(code)).toBe(true);
  });

  it('should return true if code contains path, element, and additional keys', () => {
    const code = `
      {
        path: '/example',
        element: <ExampleElement />,
        someKey: 'someValue',
      }
    `;

    expect(isRoutesFile(code)).toBe(true);
  });
});
