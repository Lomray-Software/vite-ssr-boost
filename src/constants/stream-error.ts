/**
 * React stream errors
 */
enum StreamError {
  RenderAborted = 'aborted',
  RenderTimeout = 'timeout',
  RenderCancel = 'cancel',
  RenderSkip = 'skip',
  Unknown = 'unknown',
}

export default StreamError;
