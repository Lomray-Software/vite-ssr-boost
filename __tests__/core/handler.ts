import { beforeEach, describe, expect, it, vi } from 'vitest';
import createHandler from '@core/handler';
import coreRender from '@core/render';

vi.mock('@core/render', () => ({
  default: vi.fn(),
}));

describe('createHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a standard Request to Response handler', async () => {
    const response = new Response('rendered');
    const onRequest = vi.fn(() => ({
      appProps: { app: true },
      headers: [
        ['Set-Cookie', 'one=1; Path=/'],
        ['Set-Cookie', 'two=2; Path=/'],
      ] as [string, string][],
      status: 201,
    }));

    vi.mocked(coreRender).mockImplementation(async (_, context) => {
      expect(context).toMatchObject({
        appProps: { app: true },
        html: { footer: '</html>', header: '<html>' },
        response: { status: 201 },
      });
      expect(context.response.headers.getSetCookie()).toEqual(['one=1; Path=/', 'two=2; Path=/']);

      return response;
    });

    const handler = createHandler(
      {
        createApp: vi.fn(),
        handler: {} as never,
        renderToStream: vi.fn(),
      },
      {
        getHtml: () => ({ footer: '</html>', header: '<html>' }),
        onRequest,
      },
    );
    const request = new Request('http://localhost/');

    await expect(handler(request)).resolves.toBe(response);
    expect(onRequest).toHaveBeenCalledWith({
      executionContext: undefined,
      request,
    });
  });

  it('allows onRequest to return a Response directly', async () => {
    const response = new Response(null, { status: 204 });
    const handler = createHandler(
      {
        createApp: vi.fn(),
        handler: {} as never,
        renderToStream: vi.fn(),
      },
      {
        getHtml: vi.fn(),
        onRequest: () => response,
      },
    );

    await expect(handler(new Request('http://localhost/'))).resolves.toBe(response);
    expect(coreRender).not.toHaveBeenCalled();
  });
});
