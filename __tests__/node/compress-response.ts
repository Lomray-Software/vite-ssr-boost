// @vitest-environment node
import { describe, expect, it } from 'vitest';
import compressResponse from '@node/compress-response';

describe('Node streaming compression', () => {
  it.each(['gzip', 'deflate'] as const)(
    'flushes usable %s content before the source closes',
    async (format) => {
      let source!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          source = controller;
          controller.enqueue(new TextEncoder().encode('shell'));
        },
      });
      const compressed = compressResponse(
        new Request('https://example.com', { headers: { 'Accept-Encoding': format } }),
        new Response(body),
        true,
      );
      const reader = compressed.body!.pipeThrough(new DecompressionStream(format)).getReader();

      try {
        const chunk = await reader.read();

        expect(new TextDecoder().decode(chunk.value)).toBe('shell');
        source.enqueue(new TextEncoder().encode('-footer'));
        source.close();
        const rest = await reader.read();

        expect(new TextDecoder().decode(rest.value)).toBe('-footer');
        expect((await reader.read()).done).toBe(true);
      } finally {
        await reader.cancel();
      }
    },
  );
});
