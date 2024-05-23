import StreamError from '@constants/stream-error';

export interface IObtainStreamErrorOut {
  code: StreamError;
  message: string;
  original: unknown;
}

/**
 * Get react stream error
 */
const obtainStreamError = (err: unknown): IObtainStreamErrorOut => {
  const message = ((err as Error)?.message ?? 'Unknown.').replace('Error: ', '');

  if (message === 'The render was aborted by the server without a reason.') {
    return {
      code: StreamError.RenderAborted,
      message,
      original: err,
    };
  } else if (message === 'The destination stream closed early.') {
    return {
      code: StreamError.RenderSkip,
      message,
      original: err,
    };
  }

  return {
    code: StreamError.Unknown,
    message: message || 'Unknown error',
    original: err,
  };
};

export default obtainStreamError;
