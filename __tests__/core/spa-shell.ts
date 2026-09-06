import { describe, expect, it } from 'vitest';
import createSpaShell from '@core/spa-shell';
import createSpaHtml from '@core/spa-html';

describe('cached SPA shell', () => {
  it('returns isolated shells and invalidates changed request-specific input', () => {
    const getShell = createSpaShell();
    const html = { header: '<html><head></head><body><div id="root">', footer: '</div></body></html>' };
    const first = getShell(html);
    first.header += 'request assets';
    expect(getShell(html).header).not.toContain('request assets');
    expect(html.header).not.toContain('data-force-spa');
    expect(getShell({ ...html, header: html.header.replace('<head>', '<head><title>Changed</title>') }).header).toContain('Changed');
    expect(getShell(html).header).not.toContain('Changed');
  });

  it('shares SPA index generation and handles quoted custom roots idempotently', () => {
    const html = "<html><body><div data-id='root'></div><div id='app'></div></body></html>";
    const marked = createSpaHtml(html, 'app');
    expect(marked).toContain("id='app' data-force-spa=\"1\"");
    expect(marked).toContain("<div data-id='root'></div>");
    expect(createSpaHtml(marked, 'app')).toBe(marked);
    const inferred = createSpaHtml(html);
    expect(inferred).toContain('<html data-force-spa="1">');
    expect(createSpaHtml(inferred)).toBe(inferred);
  });
});
