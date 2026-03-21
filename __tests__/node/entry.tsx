import { describe, expect, it, vi } from 'vitest';
import entry from '@node/entry';

vi.mock('@node/render', () => ({
  default: vi.fn(),
}));

describe('node entry', () => {
  it('should prepare render output with routes and options', async () => {
    const App = (() => null) as never;
    const routes = [{ path: '/' }] as never;
    const init = vi.fn();
    const loggerProd = { info: vi.fn() };
    const loggerDev = { info: vi.fn() };
    const middlewares = { compression: false as const, expressStatic: false as const };

    const result = entry(App, routes, {
      init,
      abortDelay: 100,
      loggerProd: loggerProd as never,
      loggerDev: loggerDev as never,
      middlewares,
    });

    expect(result.routes).toBe(routes);
    expect(result.init).toBe(init);
    expect(result.abortDelay).toBe(100);
    expect(result.loggerProd).toBe(loggerProd);
    expect(result.loggerDev).toBe(loggerDev);
    expect(result.middlewares).toEqual(middlewares);
    expect(typeof result.render).toBe('function');
  });
});
