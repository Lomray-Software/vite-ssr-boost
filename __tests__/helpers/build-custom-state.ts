import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import buildCustomState from '@helpers/build-custom-state';

describe('buildCustomState', () => {
  it('serializes arbitrary state keys without turning them into JavaScript or HTML', () => {
    const state = {
      'user-settings': { theme: 'dark' },
      'x;window.injected=true;//': { safe: true },
      '</script><script>window.injected=true</script>': { safe: true },
    };
    const html = buildCustomState(state);
    const context = { window: {} as Record<string, unknown> };

    for (const match of html.matchAll(/<script async>(.*?)<\/script>/g)) {
      runInNewContext(match[1], context);
    }

    expect(context.window).toEqual(state);
    expect(context.window.injected).toBeUndefined();
    expect(html.match(/<script async>/g)).toHaveLength(3);
  });
  it('should return an empty string for undefined initState', () => {
    const result = buildCustomState();

    expect(result).to.equal('');
  });

  it('should return an empty string for initState with no properties', () => {
    const result = buildCustomState({});

    expect(result).to.equal('');
  });

  it('should generate script tags for each key-value pair in initState', () => {
    const initState = {
      key1: { prop1: 'value1' },
      key2: { prop2: 'value2' },
    };

    const result = buildCustomState(initState);

    expect(result).to.equal(
      '<script async>window.key1 = JSON.parse("{\\"prop1\\":\\"value1\\"}");</script><script async>window.key2 = JSON.parse("{\\"prop2\\":\\"value2\\"}");</script>',
    );
  });

  it('should handle undefined, null, or empty string values in initState', () => {
    const initState = {
      key1: undefined,
      key2: null,
      key3: '',
    };

    const result = buildCustomState(initState as unknown as Record<string, Record<string, any>>);

    expect(result).not.toContain('<script async>window.key1 =');
    expect(result).not.toContain('<script async>window.key2 =');
    expect(result).not.toContain('<script async>window.key3 =');
  });

  it('should handle invalid initState keys or states', () => {
    const initState = {
      key1: { prop1: 'value1' },
      key2: null,
      key3: { prop3: 'value3' },
    };

    const result = buildCustomState(initState as unknown as Record<string, Record<string, any>>);

    expect(result).to.equal(
      '<script async>window.key1 = JSON.parse("{\\"prop1\\":\\"value1\\"}");</script><script async>window.key3 = JSON.parse("{\\"prop3\\":\\"value3\\"}");</script>',
    );
  });
});
