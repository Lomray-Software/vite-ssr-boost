/**
 * React stream errors
 */
enum StreamError {
  RenderAborted = 'aborted',
  RenderTimeout = 'timeout',
  RenderCancel = 'cancel',
  Unknown = 'unknown',
}

export default StreamError;
