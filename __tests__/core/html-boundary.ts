import { describe, expect, it } from 'vitest';
import htmlBoundary from '@core/html-boundary';

describe('HTML stream insertion boundaries', () => {
  it('does not insert scripts in split tags, quotes, comments or raw text', () => {
    const observe = htmlBoundary();
    const feed = (value: string) => observe(new TextEncoder().encode(value));
    expect(feed('<main title="hel')).toBe(false);
    expect(feed('lo > wor')).toBe(false);
    expect(feed('ld">')).toBe(true);
    expect(feed('<!-- foo >')).toBe(false);
    expect(feed('-->')).toBe(true);
    expect(feed('<script>const x = "<p>')).toBe(false);
    expect(feed('";</scr')).toBe(false);
    expect(feed('ipt>')).toBe(true);
    expect(feed('<style>p{color:red}')).toBe(false);
    expect(feed('</style>')).toBe(true);
    expect(feed('text spl')).toBe(false);
    expect(feed('it</main>')).toBe(true);
  });
});
