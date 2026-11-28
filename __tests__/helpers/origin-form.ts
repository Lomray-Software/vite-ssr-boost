import { describe, expect, it } from 'vitest';
import getOriginForm from '@helpers/origin-form';

describe('getOriginForm', () => {
  it('should keep an origin-form target as it is', () => {
    expect(getOriginForm('/readyz?probe=1')).toBe('/readyz?probe=1');
  });

  it('should keep the path and query of an absolute-form target', () => {
    expect(getOriginForm('http://service/readyz?probe=1')).toBe('/readyz?probe=1');
    expect(getOriginForm('https://service/assets/app.js')).toBe('/assets/app.js');
  });

  it('should keep the path of an absolute-form target as written, as for the origin form', () => {
    expect(getOriginForm('http://service/checks/../ready')).toBe('/checks/../ready');
    expect(getOriginForm('HTTP://service:8080/a/./b?x=1')).toBe('/a/./b?x=1');
    expect(getOriginForm('http://service?x=1')).toBe('/?x=1');
    expect(getOriginForm('http://service')).toBe('/');
  });

  it('should give undefined for an absolute-form path that starts with a backslash', () => {
    expect(getOriginForm('http://service\\ready')).toBeUndefined();
  });

  it('should give undefined for any other target', () => {
    expect(getOriginForm('*')).toBeUndefined();
    expect(getOriginForm('service:443')).toBeUndefined();
    expect(getOriginForm('ftp://service/file')).toBeUndefined();
  });
});
