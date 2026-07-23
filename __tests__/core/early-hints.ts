import { describe, expect, it, vi } from 'vitest';
import emitEarlyHints from '@core/early-hints';

describe('emitEarlyHints', () => {
  it('emits hints before returning', async () => {
    const earlyHints = vi.fn();
    const headers = new Headers({ Link: '</app.js>; rel=preload; as=script' });

    await emitEarlyHints({ earlyHints }, headers);

    expect(earlyHints).toHaveBeenCalledWith(headers);
  });

  it('does nothing when the transport has no Early Hints support', async () => {
    await expect(emitEarlyHints(undefined, new Headers())).resolves.toBeUndefined();
  });
});
