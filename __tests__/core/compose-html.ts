import { describe, expect, it, vi } from 'vitest';
import composeHtml from '@core/compose-html';

describe('composeHtml', () => {
  it('streams header, body and footer without dropping chunks', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('body-1'));
        controller.enqueue(encoder.encode('body-2'));
        controller.close();
      },
    });

    await expect(new Response(composeHtml('header-', body, '-footer')).text()).resolves.toBe(
      'header-body-1body-2-footer',
    );
  });

  it('cancels the source stream', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const reader = composeHtml('', body, '').getReader();

    await reader.cancel('closed');

    expect(cancel).toHaveBeenCalledWith('closed');
  });
});
