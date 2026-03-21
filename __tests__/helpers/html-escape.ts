import { describe, expect, it } from 'vitest';
import htmlEscape from '@helpers/html-escape';

describe('htmlEscape', () => {
  it('should escape html-sensitive characters', () => {
    expect(htmlEscape('&><')).toBe('\\u0026\\u003e\\u003c');
  });

  it('should escape unicode line separators', () => {
    expect(htmlEscape('\u2028\u2029')).toBe('\\u2028\\u2029');
  });

  it('should return original string when escaping is not needed', () => {
    expect(htmlEscape('plain-text')).toBe('plain-text');
  });
});
