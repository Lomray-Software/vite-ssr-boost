import { describe, expect, it } from 'vitest';
import { parseStartOptions } from '@cli/start';

describe('production CLI dispatch', () => {
  it('preserves start defaults and both forms of value options', () => {
    expect(parseStartOptions([])).toEqual({
      host: false,
      port: 3000,
      focusOnly: 'app',
      modulePreload: false,
      buildDir: undefined,
    });
    expect(parseStartOptions(['--host', '--port=8080', '--focus-only', 'client', '--build-dir', 'output directory', '--module-preload'])).toEqual({
      host: true,
      port: 8080,
      focusOnly: 'client',
      modulePreload: true,
      buildDir: 'output directory',
    });
    expect(parseStartOptions(['--port', '8080', '--port', '9090'])?.port).toBe(9090);
  });

  it.each([
    ['--help'],
    ['-h'],
    ['--unknown'],
    ['--port'],
    ['--build-dir'],
    ['--focus-only', 'invalid'],
    ['--host=false'],
    ['extra-argument'],
  ])('delegates %j to the existing command parser', (...args) => {
    expect(parseStartOptions(args)).toBeUndefined();
  });
});
