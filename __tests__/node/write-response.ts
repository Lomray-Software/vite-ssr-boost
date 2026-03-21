// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import StreamError from '@constants/stream-error';
import writeResponse from '@node/write-response';

describe('writeResponse', () => {
  const createRes = () => {
    const end = vi.fn();
    const res: Record<string, any> = {
      status: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn(),
      end: end.mockImplementation(() => res),
      redirect: vi.fn(),
      __end: end,
    };

    return res;
  };

  it('should write response shell and pipe stream', () => {
    const res = createRes();
    const pipe = vi.fn();
    const context = {
      res,
      didError: undefined,
      serverContext: { response: null },
      routerContext: { errors: null },
      html: { header: '<html><body>', footer: '</body></html>' },
    };

    writeResponse(context as never, {
      pipe,
      statusCode: 200,
      onShellReady: () => ({ header: '<head>', footer: '<foot>' }),
      getState: () => ({ custom: { value: 1 } }),
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'text/html');
    expect(res.write).toHaveBeenNthCalledWith(1, '<head>');
    expect(pipe).toHaveBeenCalledWith(res);
    expect(res.write.mock.calls.at(-1)?.[0]).toContain('<foot>');
  });

  it('should rewrite res.end for error streams', () => {
    const res = createRes();
    const pipe = vi.fn();
    const context = {
      res,
      didError: StreamError.RenderTimeout,
      serverContext: { response: null },
      routerContext: { errors: null },
      html: { header: '<html>', footer: '</html>' },
    };

    writeResponse(context as never, {
      pipe,
      statusCode: 200,
      onShellReady: undefined,
      getState: () => undefined,
    });

    res.end('done');

    expect(res.write.mock.calls.at(-1)?.[0]).toContain('</html>');
    expect(res.__end).toHaveBeenCalledWith('done');
  });

  it('should stop when handleResponse resolved to redirect', () => {
    const res = createRes();
    const pipe = vi.fn();
    const context = {
      res,
      didError: undefined,
      serverContext: {
        response: new Response(null, { status: 302, headers: { Location: '/redirect' } }),
      },
      routerContext: { errors: null },
      html: { header: '<html>', footer: '</html>' },
    };

    writeResponse(context as never, {
      pipe,
      statusCode: 200,
      onShellReady: undefined,
      getState: () => undefined,
    });

    expect(pipe).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302, '/redirect');
  });
});
