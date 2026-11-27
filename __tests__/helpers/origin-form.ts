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

  it('should give undefined for any other target', () => {
    expect(getOriginForm('*')).toBeUndefined();
    expect(getOriginForm('service:443')).toBeUndefined();
    expect(getOriginForm('ftp://service/file')).toBeUndefined();
  });
});
