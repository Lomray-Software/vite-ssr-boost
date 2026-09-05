import { describe, expect, it, vi } from 'vitest';
import adapterEdge from '@adapters/edge';

describe('Edge adapter', () => {
  it('isolates platform arguments from the Fetch core handler', async () => {
    const handler = vi.fn(async () => new Response('edge'));
    const adapted = adapterEdge(handler);
    const request = new Request('https://edge.example/');
    const platformEnv = { SECRET: 'platform-only' };
    const platformContext = { waitUntil: vi.fn() };

    await expect(adapted(request, platformEnv, platformContext)).resolves.toBeInstanceOf(Response);
    expect(handler).toHaveBeenCalledWith(request);
  });
});
