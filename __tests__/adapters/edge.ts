import { describe, expect, it, vi } from 'vitest';
import adapterEdge from '@adapters/edge';

describe('Edge adapter', () => {
  it('keeps the Fetch handler unchanged', async () => {
    const handler = vi.fn(async () => new Response('edge'));
    const adapted = adapterEdge(handler);
    const request = new Request('https://edge.example/');

    expect(adapted).toBe(handler);
    await expect(adapted(request)).resolves.toBeInstanceOf(Response);
    expect(handler).toHaveBeenCalledWith(request);
  });
});
