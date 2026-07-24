// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import writeFetchResponse from '@node/write-fetch-response';

describe('writeFetchResponse', () => {
  it('stops reading until the Node response drains', async () => {
    const chunks: Uint8Array[] = [];
    const encoder = new TextEncoder();
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pullCount += 1;
          controller.enqueue(encoder.encode(pullCount === 1 ? 'first-' : 'final'));

          if (pullCount === 2) {
            controller.close();
          }
        },
      },
      { highWaterMark: 0 },
    );
    const res = Object.assign(new EventEmitter(), {
      appendHeader: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
      end: vi.fn(function end(this: { writableEnded: boolean }) {
        this.writableEnded = true;
      }),
      headersSent: false,
      setHeader: vi.fn(),
      statusCode: 0,
      writableEnded: false,
      write: vi.fn((chunk: Uint8Array) => {
        chunks.push(chunk);

        return chunks.length !== 1;
      }),
    });
    const pending = writeFetchResponse(res as never, new Response(body));

    await vi.waitFor(() => expect(res.write).toHaveBeenCalledOnce());
    expect(pullCount).toBe(1);

    res.emit('drain');
    await pending;

    expect(pullCount).toBe(2);
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe('first-final');
    expect(res.end).toHaveBeenCalledOnce();
    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('cancels the Web stream when the Node transport fails', async () => {
    const cancel = vi.fn();
    const error = new Error('transport failed');
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull: (controller) => controller.enqueue(new Uint8Array([1])),
    });
    const res = Object.assign(new EventEmitter(), {
      appendHeader: vi.fn(),
      destroy: vi.fn(function destroy(this: { destroyed: boolean }) {
        this.destroyed = true;
      }),
      destroyed: false,
      end: vi.fn(),
      headersSent: false,
      setHeader: vi.fn(),
      statusCode: 0,
      writableEnded: false,
      write: vi.fn(() => {
        throw error;
      }),
    });

    await writeFetchResponse(res as never, new Response(body));

    expect(cancel).toHaveBeenCalledWith(error);
    expect(res.destroy).toHaveBeenCalledWith(error);
  });
});
