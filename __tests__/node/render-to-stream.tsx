// @vitest-environment node
import type { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import renderToStream from '@node/render-to-stream';

const fixture = vi.hoisted(() => ({ written: 0 }));

vi.mock('react-dom/server', () => ({
  renderToPipeableStream: vi.fn((_, callbacks) => ({
    abort: vi.fn(),
    pipe: (destination: Writable) => {
      const pump = (): void => {
        while (fixture.written < 100) {
          fixture.written += 1;

          if (!destination.write(Buffer.alloc(64 * 1024))) {
            destination.once('drain', pump);
            return;
          }
        }

        callbacks.onAllReady();
        destination.end();
      };

      pump();
    },
  })),
}));

describe('Node render stream buffering', () => {
  it('bounds the Web bridge by bytes while its consumer is paused', async () => {
    fixture.written = 0;
    const output = await renderToStream(<main />, {
      onError: vi.fn(),
      signal: new AbortController().signal,
    });

    output.start();
    await setImmediate();

    // A count-based queue incorrectly buffers all 6.4 MB before anyone reads.
    expect(fixture.written).toBeLessThanOrEqual(4);
    expect((await new Response(output.stream).arrayBuffer()).byteLength).toBe(100 * 64 * 1024);
  });
});
