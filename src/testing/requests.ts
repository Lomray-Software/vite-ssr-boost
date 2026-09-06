/**
 * Give relative test URLs a stable origin without starting a server.
 */
const TEST_ORIGIN = 'http://localhost';

/** Give relative test paths the same stable origin as createTestHandler.fetch. */
const browserRequest = (path: string): Request =>
  new Request(new URL(path, TEST_ORIGIN), {
    headers: { 'User-Agent': 'Mozilla/5.0 (SSR Boost route test)' },
  });

/** Identification only: the application's onRouterReady hook chooses buffering. */
const crawlerRequest = (path: string): Request =>
  new Request(new URL(path, TEST_ORIGIN), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    },
  });

export { browserRequest, crawlerRequest, TEST_ORIGIN };
