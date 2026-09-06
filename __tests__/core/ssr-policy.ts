// @vitest-environment node
import { createStaticHandler } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SsrPolicy, { ISsrPolicy } from '@core/ssr-policy';
import Diagnostics from '@services/diagnostics';

const human =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const request = (path: string, agent = human) =>
  new Request(`https://example.test${path}`, { headers: { 'User-Agent': agent } });
const routes = createStaticHandler([
  {
    id: 'layout',
    path: '/',
    children: [
      { id: 'home', index: true },
      { id: 'public', path: 'public/:slug' },
      { id: 'private', path: 'private' },
      { id: 'fallback', path: '*' },
    ],
  },
]).dataRoutes;

afterEach(() => vi.unstubAllEnvs());

describe('SSR policy patterns', () => {
  it.each<[ISsrPolicy, string, string]>([
    [{}, '/private', 'ssr'],
    [{ mode: 'all', routes: ['/private'] }, '/elsewhere', 'ssr'],
    [{ mode: 'include' }, '/', 'spa'],
    [{ mode: 'exclude' }, '/', 'ssr'],
    [{ mode: 'include', routes: ['/public/:slug'] }, '/public/hello?preview=1', 'ssr'],
    [{ mode: 'include', routes: ['/public/:slug'] }, '/public/hello/extra', 'spa'],
    [{ mode: 'include', routes: ['/public/:slug'] }, '/public/hello/', 'ssr'],
    [{ mode: 'include', routes: ['/public/:slug'] }, '/public/%E0%A4%A', 'ssr'],
    [{ mode: 'include', routes: ['/public{/:slug}'] }, '/public', 'ssr'],
    [{ mode: 'include', routes: ['/public/*parts'] }, '/public/a/b', 'ssr'],
    [{ mode: 'include', routes: [/^\/public\//] }, '/public/hello', 'ssr'],
    [{ mode: 'exclude', routes: ['/private'] }, '/private?x=1', 'spa'],
    [{ mode: 'exclude', routes: ['/private'] }, '/', 'ssr'],
    [{ mode: 'exclude', routes: [/^\/private$/] }, '/private', 'spa'],
    [{ mode: 'include', routes: ['/'] }, '/private', 'spa'],
  ])('%j at %s selects %s', (config, path, expected) => {
    expect(new SsrPolicy(config, routes).select(request(path))).toBe(expected);
  });

  it('resets cloned global and sticky regex state on every request', () => {
    const pattern = /^\/private/gy;
    pattern.lastIndex = 20;
    const policy = new SsrPolicy({ mode: 'exclude', routes: [pattern] }, routes);
    expect(policy.select(request('/private'))).toBe('spa');
    expect(policy.select(request('/private'))).toBe('spa');
    expect(pattern.lastIndex).toBe(20);
  });

  it('passes the same Request, parsed URL and bot flag to decide', () => {
    const decide = vi.fn(({ url }) => (url.searchParams.has('spa') ? ('spa' as const) : undefined));
    const policy = new SsrPolicy({ decide, bots: 'policy' }, routes);
    const input = request('/private?spa=1', 'Googlebot');
    expect(policy.select(input)).toBe('spa');
    expect(decide).toHaveBeenCalledWith({ request: input, url: new URL(input.url), isBot: true });
    expect(policy.select(request('/private'))).toBe('ssr');
  });

  it('keeps bots on SSR ahead of decide unless bots follows policy', () => {
    const decide = vi.fn(() => 'spa' as const);
    expect(new SsrPolicy({ decide }).select(request('/private', 'Googlebot'))).toBe('ssr');
    expect(decide).not.toHaveBeenCalled();
    expect(new SsrPolicy({ decide, bots: 'policy' }).select(request('/private', 'Googlebot'))).toBe(
      'spa',
    );
  });

  it('rejects malformed patterns at construction, before accepting requests', () => {
    expect(() => new SsrPolicy({ mode: 'include', routes: ['/bad/:'] })).toThrow();
  });
});

describe('SSR_BOOST_SSR_ROUTES startup override', () => {
  it.each([
    ['/', '/', 'ssr'],
    ['/', '/private', 'spa'],
    ['!/private', '/private', 'spa'],
    ['!/private', '/', 'ssr'],
    [' /public/:slug , !/public/draft, ', '/public/hello', 'ssr'],
    ['/public/:slug,!/public/draft', '/public/draft', 'spa'],
    ['/public/:slug,!/public/draft', '/', 'spa'],
    ['', '/private', 'ssr'],
  ])('%s at %s selects %s', (env, path, expected) => {
    vi.stubEnv('SSR_BOOST_SSR_ROUTES', env);
    const decide = vi.fn(() => 'spa' as const);
    const policy = new SsrPolicy({ mode: 'include', routes: ['/ignored'], decide }, routes);
    expect(policy.select(request(path))).toBe(expected);
    expect(decide).not.toHaveBeenCalled();
  });

  it('snapshots overrides and retains bot protection across later env changes', () => {
    vi.stubEnv('SSR_BOOST_SSR_ROUTES', '!/private');
    const policy = new SsrPolicy({}, routes);
    vi.stubEnv('SSR_BOOST_SSR_ROUTES', '/private');
    expect(policy.select(request('/private'))).toBe('spa');
    expect(policy.select(request('/private', 'Googlebot'))).toBe('ssr');
    expect(new SsrPolicy({}, routes).select(request('/private'))).toBe('ssr');
  });

  it('rejects a bare exclusion marker', () => {
    vi.stubEnv('SSR_BOOST_SSR_ROUTES', '!');
    expect(() => new SsrPolicy()).toThrow();
  });

  it('works without Node globals in Fetch runtimes', () => {
    const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')!;
    try {
      Reflect.deleteProperty(globalThis, 'process');
      expect(new SsrPolicy({ mode: 'include' }).select(request('/'))).toBe('spa');
    } finally {
      Object.defineProperty(globalThis, 'process', processDescriptor);
    }
  });
});

describe('policy diagnostics', () => {
  it('logs decisions once per pattern, with no concrete URL or query values', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const policy = new SsrPolicy({ mode: 'include', routes: ['/public/:slug'] }, routes);
    for (const path of ['/public/first?secret=one', '/public/second?secret=two']) {
      policy.select(request(path), new Diagnostics(path, logger));
    }
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0][0]).toContain(
      'SSR_BOOST_SSR_POLICY: Pattern "/public/:slug" selects ssr via config include',
    );
    expect(logger.info.mock.calls[0][0]).not.toMatch(/secret|first|second/);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns once about a typo even when the router has a 404 catch-all', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const policy = new SsrPolicy({ mode: 'exclude', routes: ['/privtae'] }, routes);
    for (let count = 0; count < 2; count += 1) {
      policy.select(request('/'), new Diagnostics('/', logger));
    }
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0]).toContain(
      'SSR_BOOST_SSR_POLICY_UNMATCHED: Pattern "/privtae" matches no known route id',
    );
  });

  it('handles basenames and concrete dynamic URLs without typo warnings', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const policy = new SsrPolicy(
      { mode: 'include', routes: ['/app/public/hello', /^\/app\/private$/] },
      routes,
      '/app',
    );
    policy.select(request('/app/public/hello'), new Diagnostics('/', logger));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('leaves default all mode silent', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    new SsrPolicy().select(request('/'), new Diagnostics('/', logger));
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
