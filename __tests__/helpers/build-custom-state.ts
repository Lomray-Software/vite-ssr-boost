import { expect } from 'chai';
import { describe, it } from 'vitest';
import buildCustomState from '@helpers/build-custom-state';

describe('buildCustomState', () => {
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

    expect(result).to.include('<script async>window.key1 = {"prop1":"value1"}</script>');
    expect(result).to.include('<script async>window.key2 = {"prop2":"value2"}</script>');
  });

  it('should handle undefined, null, or empty string values in initState', () => {
    const initState = {
      key1: undefined,
      key2: null,
      key3: '',
    };

    const result = buildCustomState(initState as unknown as Record<string, Record<string, any>>);

    expect(result).to.not.include('<script async>window.key1 =');
    expect(result).to.not.include('<script async>window.key2 =');
    expect(result).to.not.include('<script async>window.key3 =');
  });

  it('should handle invalid initState keys or states', () => {
    const initState = {
      key1: { prop1: 'value1' },
      key2: null,
      key3: { prop3: 'value3' },
    };

    const result = buildCustomState(initState as unknown as Record<string, Record<string, any>>);

    expect(result).to.include('<script async>window.key1 = {"prop1":"value1"}</script>');
    expect(result).to.not.include('<script async>window.key2 =');
    expect(result).to.include('<script async>window.key3 = {"prop3":"value3"}</script>');
  });
});
