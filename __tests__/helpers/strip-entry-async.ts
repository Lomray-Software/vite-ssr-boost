import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
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
    expect(
      stripEntryAsync('<script async type="module" src="/client.ts"></script>', '/', 'client.ts'),
    ).toBe('<script type="module" src="/client.ts"></script>');
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
    const html =
      '<script src="app/client.ts" async></script><script src="/client.ts" async></script>';

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
      '<script src="/app/x/%2E%2e/client.ts" async></script>',
    ].join('');

    expect(stripEntryAsync(others + entry, '/app/', 'client.ts')).toBe(
      `${others}<script src="/app/client.ts"></script>`,
    );
  });

  it('should keep async on a src with an empty segment, which names another path', () => {
    const html = '<script src="/app//client.ts" async></script>';

    expect(stripEntryAsync(html, '/app/', 'client.ts')).toBe(html);
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

  it('should keep async when the base element names a scheme or a host', () => {
    const scripts = '<script src="client.ts" async></script>';

    for (const href of ['http://document.invalid/app/', '//document.invalid/app/']) {
      const html = `<base href=" ${href}">${scripts}`;

      expect(stripEntryAsync(html, '/app/', 'client.ts', '/app/page')).toBe(html);
    }
  });

  it('should ignore a base element inside SVG, which sets no document base', () => {
    const html = '<svg><base href="/icons/"></base></svg><script src="client.ts" async></script>';

    expect(stripEntryAsync(html, '/app/', 'client.ts', '/app/page')).toBe(
      '<svg><base href="/icons/"></base></svg><script src="client.ts"></script>',
    );
  });

  it('should resolve a parent-relative base element from the document URL', () => {
    const html = '<base href=" ../"><script src="client.ts" async></script>';

    expect(stripEntryAsync(html, '/app/', 'client.ts', '/app/blog/post')).toBe(
      '<base href=" ../"><script src="client.ts"></script>',
    );
    expect(stripEntryAsync(html, '/app/', 'client.ts', '/app/post')).toBe(html);
  });

  it('should drop the whitespace the browser trims around a src', () => {
    expect(stripEntryAsync('<script src=" /client.ts\n" async></script>', '/', 'client.ts')).toBe(
      '<script src=" /client.ts\n"></script>',
    );
  });

  it('should keep async when a base names a scheme or a host the URL parser cleans up', () => {
    const scripts = '<script src="client.ts" async></script>';

    for (const href of [
      'ht&#9;tp://document.invalid/app/',
      'ht\ntp://document.invalid/app/',
      '\x01http://document.invalid/app/',
      '/\t/document.invalid/app/',
    ]) {
      const html = `<base href="${href}">${scripts}`;

      expect(stripEntryAsync(html, '/app/', 'client.ts', '/app/page')).toBe(html);
    }
  });

  it('should keep async on a src whose scheme the URL parser cleans up', () => {
    for (const src of [
      'ht\ntp://document.invalid/app/client.ts',
      '\x01//document.invalid/app/client.ts',
    ]) {
      const html = `<script src="${src}" async></script>`;

      expect(stripEntryAsync(html, '/app/', 'client.ts')).toBe(html);
    }
  });

  it('should resolve from the document URL when the base element does not parse', () => {
    for (const href of ['http://[', '//[']) {
      const html = `<base href="${href}"><script src="/client.ts" async></script>`;

      expect(stripEntryAsync(html, '/', 'client.ts')).toBe(
        `<base href="${href}"><script src="/client.ts"></script>`,
      );
    }
  });

  it('should resolve each script from the base in effect where the parser reached it', () => {
    const script = '<script src="client.ts" async></script>';
    const local = `${script}<base href="/docs/">${script}`;

    expect(stripEntryAsync(local, '/app/', 'client.ts', '/app/page')).toBe(
      `<script src="client.ts"></script><base href="/docs/">${script}`,
    );

    const rooted = '<script src="/client.ts" async></script>';
    const foreign = `${rooted}<base href="https://cdn.test/">${rooted}`;

    expect(stripEntryAsync(foreign, '/', 'client.ts')).toBe(
      `<script src="/client.ts"></script><base href="https://cdn.test/">${rooted}`,
    );
  });

  it('should resolve from the document URL when the base element is a data or script URL', () => {
    for (const href of ['data:,x', 'javascript:void(0)']) {
      const tail = '<base href="/docs/"><script src="client.ts"';

      expect(
        stripEntryAsync(
          `<base href="${href}">${tail} async></script>`,
          '/app/',
          'client.ts',
          '/app/page',
        ),
      ).toBe(`<base href="${href}">${tail}></script>`);
    }
  });

  it('should resolve a script from the base the parser had reached, not the tree order', () => {
    const html = '<table><script src="client.ts" async></script><base href="/docs/"></table>';

    expect(stripEntryAsync(html, '/app/', 'client.ts', '/app/page')).toBe(
      '<table><script src="client.ts"></script><base href="/docs/"></table>',
    );
  });

  it('should resolve a script from the first base in tree order the parser had inserted', () => {
    const tail = '<base href="/app/"></table><script src="client.ts" async></script>';
    const html = `<table><tr><td><base href="/old/"></td></tr>${tail}`;

    expect(stripEntryAsync(html, '/app/', 'client.ts', '/x/page')).toBe(html.replace(' async', ''));
  });

  it('should keep an attribute written right after async apart from an unquoted src', () => {
    const result = stripEntryAsync(
      '<script src=/client.ts async=""defer></script>',
      '/',
      'client.ts',
    );
    const [script] = parseFragment(result).childNodes as DefaultTreeAdapterTypes.Element[];

    expect(script.attrs).toEqual([
      { name: 'src', value: '/client.ts' },
      { name: 'defer', value: '' },
    ]);
  });

  it('should keep the self-closing slash out of an unquoted src', () => {
    const result = stripEntryAsync('<script src=/client.ts async/></script>', '/', 'client.ts');
    const [script] = parseFragment(result).childNodes as DefaultTreeAdapterTypes.Element[];

    expect(script.attrs).toEqual([{ name: 'src', value: '/client.ts' }]);
  });

  it('should keep async on a script inside SVG, which is not an HTML script', () => {
    const html = '<svg><script src="/client.ts" async></script></svg>';

    expect(stripEntryAsync(html, '/', 'client.ts')).toBe(html);
  });

  it('should remove a repeated async attribute', () => {
    const html = '<script async src="/client.ts" async></script>';

    expect(stripEntryAsync(html, '/', 'client.ts')).toBe('<script src="/client.ts"></script>');
  });
});
