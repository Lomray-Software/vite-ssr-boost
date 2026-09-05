import { describe, expect, it, vi } from 'vitest';
import emitEarlyHints from '@core/early-hints';

describe('emitEarlyHints', () => {
  it('emits hints before returning', async () => {
    const onEarlyHints = vi.fn();
    const headers = new Headers({ Link: '</app.js>; rel=preload; as=script' });

    await emitEarlyHints({ onEarlyHints }, headers);

    expect(onEarlyHints).toHaveBeenCalledWith(headers);
  });

  it('does nothing when the transport has no Early Hints support', async () => {
    await expect(emitEarlyHints(undefined, new Headers())).resolves.toBeUndefined();
  });
});
