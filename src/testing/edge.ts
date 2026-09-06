import renderToStream from '@edge/render-to-stream';
import testHandlerFactory from './create-handler';

/**
 * Create edge route test handlers that require an in-memory shell.
 */
const createTestHandler = testHandlerFactory(renderToStream, () => {
  throw new Error('shell.indexFile requires Node. In edge tests pass shell: { header, footer }.');
});

export { createTestHandler };

/**
 * Expose manual control over deferred loader settlement.
 */
export { default as createDeferred } from './deferred';

/**
 * Supply browser and crawler request identities for route tests.
 */
export { browserRequest, crawlerRequest } from './requests';

/**
 * Expose repeatable response assertions for route tests.
 */
export { default as TestResponse } from './response';

export type { ITestHandler, ITestHandlerOptions, ITestRequestInit } from './create-handler';

export type { ITestChunk, ITestCookie, ITestResponseOptions } from './response';

export type { IRouterState, TStreamFrame } from './parse-response';

export type { ITimelineEvent, TRequestStage } from '@services/request-timeline';
