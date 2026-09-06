import renderToStream from '@node/render-to-stream';
import testHandlerFactory from './testing/create-handler';

const createTestHandler = testHandlerFactory(renderToStream, async (options) =>
  (await import('@node/production')).loadHtmlShell(options),
);

export { createTestHandler };

export { default as createDeferred } from './testing/deferred';

export { browserRequest, crawlerRequest } from './testing/requests';

export { default as TestResponse } from './testing/response';

export type { ITestHandler, ITestHandlerOptions, ITestRequestInit } from './testing/create-handler';

export type { ITestChunk, ITestCookie, ITestResponseOptions } from './testing/response';

export type { IRouterState, TStreamFrame } from './testing/parse-response';

export type { ITimelineEvent, TRequestStage } from '@services/request-timeline';
