import renderToStream from '@edge/render-to-stream';
import testHandlerFactory from './create-handler';

const createTestHandler = testHandlerFactory(renderToStream, () => {
  throw new Error('shell.indexFile requires Node. In edge tests pass shell: { header, footer }.');
});

export { createTestHandler };

export { default as createDeferred } from './deferred';

export { browserRequest, crawlerRequest } from './requests';

export { default as TestResponse } from './response';

export type { ITestHandler, ITestHandlerOptions, ITestRequestInit } from './create-handler';

export type { ITestChunk, ITestCookie, ITestResponseOptions } from './response';

export type { IRouterState, TStreamFrame } from './parse-response';

export type { ITimelineEvent, TRequestStage } from '@services/request-timeline';
