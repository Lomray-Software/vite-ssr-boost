// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import createHandler from '@core/handler';
import RequestTimeline, { createTimeline } from '@services/request-timeline';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('does not construct a timeline, read its clock or attach listeners when disabled', () => {
  vi.stubEnv('SSR_BOOST_TIMELINE', '');
  const request = new Request('https://test/');
  const clock = vi.spyOn(performance, 'now');
  const listener = vi.spyOn(request.signal, 'addEventListener');
  expect(createTimeline(request, false)).toBeUndefined();
  expect(clock).not.toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
  const timeline = createTimeline(request, true);
  expect(timeline).toBeInstanceOf(RequestTimeline);
  expect(clock).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledTimes(1);
  timeline!.end();
});

it('records one JSON line in development with the environment override and no diagnostic warnings', async () => {
  vi.stubEnv('SSR_BOOST_TIMELINE', '1');
  vi.stubEnv('SSR_BOOST_DIAGNOSTICS', '0');
  vi.stubEnv('NODE_ENV', 'development');
  const log = vi.spyOn(console, 'info');
  const handler = createHandler(
    { createApp: vi.fn(), handler: {} as never, renderToStream: vi.fn() },
    {
      diagnostics: false,
      getHtml: vi.fn(),
      onRequest: () => new Response('bypass'),
      onContext: ({ context }) => {
        expect(context.timeline).toBeInstanceOf(RequestTimeline);
        expect(context.diagnostics).toBeUndefined();
      },
    },
  );
  const response = await handler(new Request('https://test/bypass?private=excluded'));
  expect(log).not.toHaveBeenCalled();
  expect(await response.text()).toBe('bypass');
  expect(log).toHaveBeenCalledTimes(1);
  expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
    type: 'SSR_BOOST_TIMELINE',
    path: '/bypass',
    method: 'GET',
    timeline: [{ stage: 'response.end', at: expect.any(Number) }],
  });
});

it('records cancellations once, finishes after downstream cancellation and stays silent in production', async () => {
  vi.stubEnv('SSR_BOOST_TIMELINE', '1');
  vi.stubEnv('NODE_ENV', 'production');
  const controller = new AbortController();
  const timeline = createTimeline(
    new Request('https://test/', { signal: controller.signal }),
    false,
  )!;
  const log = vi.spyOn(console, 'info');
  const cancel = vi.fn();
  const response = timeline.response(new Response(new ReadableStream({ cancel })));
  controller.abort(new Error('disconnected'));
  await response.body!.cancel('consumer closed');
  timeline.end();
  expect(timeline.events.map((event) => event.stage)).toEqual(['abort', 'response.end']);
  expect(timeline.events[0].reason).toBe('disconnected');
  expect(cancel).toHaveBeenCalledWith('consumer closed');
  expect(log).not.toHaveBeenCalled();
});

it('retains structured cancellation reasons without allowing cyclic reasons to break rendering', () => {
  const timeline = new RequestTimeline(new Request('https://test/'));
  timeline.abort({ code: 'request_closed' });
  expect(timeline.events[0].reason).toBe('{"code":"request_closed"}');
  timeline.end();
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const second = new RequestTimeline(new Request('https://test/'));
  second.abort(cyclic);
  expect(second.events[0].reason).toBe('Unserializable abort reason');
  second.end();
});

it('logs failures during request initialization once and cleans up listeners', async () => {
  vi.stubEnv('SSR_BOOST_TIMELINE', '1');
  vi.stubEnv('NODE_ENV', 'development');
  const controller = new AbortController();
  const log = vi.spyOn(console, 'info');
  const handler = createHandler(
    { createApp: vi.fn(), handler: {} as never, renderToStream: vi.fn() },
    {
      getHtml: vi.fn(),
      onRequest: () => {
        throw new Error('bad init');
      },
    },
  );
  await expect(
    handler(new Request('https://test/', { signal: controller.signal })),
  ).rejects.toThrow('bad init');
  controller.abort('late abort');
  expect(log).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(log.mock.calls[0][0] as string).timeline.map(
      (event: { stage: string }) => event.stage,
    ),
  ).toEqual(['abort', 'response.end']);
});
