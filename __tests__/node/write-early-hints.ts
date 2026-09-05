// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import writeEarlyHints from '@node/write-early-hints';

describe('writeEarlyHints', () => {
  it('feature-detects unsupported transports', () => {
    expect(() =>
      writeEarlyHints({ headersSent: false } as never, new Headers({ Link: '</app.js>' })),
    ).not.toThrow();
  });

  it('writes hints when the transport supports them', () => {
    const write = vi.fn();

    writeEarlyHints(
      {
        headersSent: false,
        writeEarlyHints: write,
      } as never,
      new Headers({ Link: '</app.js>; rel=preload; as=script' }),
    );

    expect(write).toHaveBeenCalledWith({
      link: ['</app.js>; rel=preload; as=script'],
    });
  });

  it('does nothing after final headers are sent', () => {
    const write = vi.fn();

    writeEarlyHints(
      {
        headersSent: true,
        writeEarlyHints: write,
      } as never,
      new Headers({ Link: '</app.js>' }),
    );

    expect(write).not.toHaveBeenCalled();
  });
});
