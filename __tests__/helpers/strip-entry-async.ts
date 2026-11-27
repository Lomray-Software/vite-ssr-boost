import { describe, expect, it } from 'vitest';
import stripEntryAsync from '@helpers/strip-entry-async';

describe('stripEntryAsync', () => {
  it('should remove async from the client entry only', () => {
    const html = '<script src="/client.ts" async></script><script src="/other.ts" async></script>';

    expect(stripEntryAsync(html, '/', 'client.ts')).toBe(
      '<script src="/client.ts"></script><script src="/other.ts" async></script>',
    );
  });

  it('should match an entry path with pattern characters literally', () => {
    const html = [
      '<script src="/app/client[web].ts" async></script>',
      '<script src="/app/clientw.ts" async></script>',
    ].join('');

    expect(stripEntryAsync(html, '/app/', 'client[web].ts')).toBe(
      '<script src="/app/client[web].ts"></script><script src="/app/clientw.ts" async></script>',
    );
  });

  it('should keep async on a sibling file that shares the entry prefix', () => {
    const html = '<script type="module" src="/client.tsx" async></script>';

    expect(stripEntryAsync(html, '/', 'client.ts')).toBe(html);
  });

  it('should remove async written before src, with a value or in any case', () => {
    expect(stripEntryAsync('<script async type="module" src="/client.ts"></script>', '/', 'client.ts')).toBe(
      '<script type="module" src="/client.ts"></script>',
    );
    expect(stripEntryAsync('<script src="/client.ts" async=""></script>', '/', 'client.ts')).toBe(
      '<script src="/client.ts"></script>',
    );
    expect(stripEntryAsync("<script ASYNC='async' src=client.ts></script>", '/', 'client.ts')).toBe(
      '<script src=client.ts></script>',
    );
  });

  it('should match the entry with a query or fragment and leave other attribute text alone', () => {
    const html = '<script data-note=" async" src="/client.ts?v=1#x" async></script>';

    expect(stripEntryAsync(html, '/', 'client.ts')).toBe(
      '<script data-note=" async" src="/client.ts?v=1#x"></script>',
    );
  });

  it('should match the entry under a base with or without a leading slash', () => {
    const html = '<script src="app/client.ts" async></script><script src="/client.ts" async></script>';

    expect(stripEntryAsync(html, '/app/', 'client.ts')).toBe(
      '<script src="app/client.ts"></script><script src="/client.ts" async></script>',
    );
  });

  it('should read a tag whose attribute value holds a closing bracket', () => {
    const html = '<script data-note="a > b" src="/client.ts" async></script>';

    expect(stripEntryAsync(html, '/', 'client.ts')).toBe(
      '<script data-note="a > b" src="/client.ts"></script>',
    );
  });

  it('should leave a script tag written inside an inline script byte for byte', () => {
    const html = [
      '<script>const tag = \'<script src="/client.ts" async>\';</script>',
      '<script src="/client.ts" async></script>',
    ].join('');

    expect(stripEntryAsync(html, '/', 'client.ts')).toBe(
      '<script>const tag = \'<script src="/client.ts" async>\';</script>' +
        '<script src="/client.ts"></script>',
    );
  });

  it('should match the entry under a relative base', () => {
    const html = '<script type="module" src="./client.ts" async></script>';

    expect(stripEntryAsync(html, './', 'client.ts')).toBe(
      '<script type="module" src="./client.ts"></script>',
    );
  });

  it('should keep async on a src for another host, scheme or parent directory', () => {
    const entry = '<script src="/app/client.ts" async></script>';
    const others = [
      '<script src="//app/client.ts" async></script>',
      '<script src="\\\\app/client.ts" async></script>',
      '<script src="https://cdn.test/app/client.ts" async></script>',
      '<script src="/app/../app/client.ts" async></script>',
    ].join('');

    expect(stripEntryAsync(others + entry, '/app/', 'client.ts')).toBe(
      `${others}<script src="/app/client.ts"></script>`,
    );
  });

  it('should keep a no-break space that ends the attribute value before async', () => {
    const html = '<script data-label=x\u00a0 async src="/client.ts"></script>';

    expect(stripEntryAsync(html, '/', 'client.ts')).toBe(
      '<script data-label=x\u00a0 src="/client.ts"></script>',
    );
  });

  it('should resolve a relative src from the document URL on a nested route', () => {
    const rooted = '<script src="/app/client.ts" async></script>';
    const relative = '<script src="client.ts" async></script>';

    expect(stripEntryAsync(rooted, '/app/', 'client.ts', '/app/blog/post?x=1')).toBe(
      '<script src="/app/client.ts"></script>',
    );
    expect(stripEntryAsync(relative, '/app/', 'client.ts', '/app/blog/post')).toBe(relative);
    expect(stripEntryAsync(relative, '/app/', 'client.ts', '/app/about')).toBe(
      '<script src="client.ts"></script>',
    );
    expect(stripEntryAsync(relative, '/', 'client.ts', '/blog/post')).toBe(relative);
  });

  it('should resolve a relative src from the base element', () => {
    const scripts = '<script src="client.ts" async></script>';

    expect(
      stripEntryAsync(`<base href="/app/">${scripts}`, '/app/', 'client.ts', '/app/blog/post'),
    ).toBe('<base href="/app/"><script src="client.ts"></script>');
    expect(stripEntryAsync(`<base href="/docs/">${scripts}`, '/', 'client.ts')).toBe(
      `<base href="/docs/">${scripts}`,
    );

    const foreign = '<base href="https://cdn.test/"><script src="/client.ts" async></script>';

    expect(stripEntryAsync(foreign, '/', 'client.ts')).toBe(foreign);
  });

  it('should drop the whitespace the browser trims around a src', () => {
    expect(stripEntryAsync('<script src=" /client.ts\n" async></script>', '/', 'client.ts')).toBe(
      '<script src=" /client.ts\n"></script>',
    );
  });

  it('should remove a repeated async attribute', () => {
    const html = '<script async src="/client.ts" async></script>';

    expect(stripEntryAsync(html, '/', 'client.ts')).toBe('<script src="/client.ts"></script>');
  });
});
