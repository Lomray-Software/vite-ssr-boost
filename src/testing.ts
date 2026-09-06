import renderToStream from '@node/render-to-stream';
import testHandlerFactory from './testing/create-handler';

/**
 * Create route test handlers with Node rendering and optional file-backed shells.
 */
const createTestHandler = testHandlerFactory(renderToStream, async (options) =>
  (await import('@node/production')).loadHtmlShell(options),
);

export { createTestHandler };

/**
 * Expose manual control over deferred loader settlement.
 */
export { default as createDeferred } from './testing/deferred';

/**
 * Supply browser and crawler request identities for route tests.
 */
export { browserRequest, crawlerRequest } from './testing/requests';

/**
 * Expose repeatable response assertions for route tests.
 */
export { default as TestResponse } from './testing/response';

export type { ITestHandler, ITestHandlerOptions, ITestRequestInit } from './testing/create-handler';

export type { ITestChunk, ITestCookie, ITestResponseOptions } from './testing/response';

export type { IRouterState, TStreamFrame } from './testing/parse-response';

export type { ITimelineEvent, TRequestStage } from '@services/request-timeline';
