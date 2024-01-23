import { expect } from 'chai';
import { describe, it } from 'vitest';
import StreamError from '@constants/stream-error';
import obtainStreamError from '@helpers/obtain-stream-error';

describe('obtainStreamError', () => {
  it('should return RenderAborted error for a specific error message', () => {
    const errorMessage = 'The render was aborted by the server without a reason.';
    const err = new Error(errorMessage);

    const result = obtainStreamError(err);

    expect(result).to.deep.equal({
      code: StreamError.RenderAborted,
      message: errorMessage,
      original: err,
    });
  });

  it('should return Unknown error for an unknown error message', () => {
    const errorMessage = 'Some unknown error.';
    const err = new Error(errorMessage);

    const result = obtainStreamError(err);

    expect(result).to.deep.equal({
      code: StreamError.Unknown,
      message: errorMessage,
      original: err,
    });
  });

  it('should return Unknown error for an error without a message', () => {
    // eslint-disable-next-line unicorn/error-message
    const err = new Error();
    const result = obtainStreamError(err);

    expect(result).to.deep.equal({
      code: StreamError.Unknown,
      message: 'Unknown error',
      original: err,
    });
  });

  it('should return Unknown error for a non-Error object', () => {
    const err = { someKey: 'someValue' };
    const result = obtainStreamError(err);

    expect(result).to.deep.equal({
      code: StreamError.Unknown,
      message: 'Unknown.',
      original: err,
    });
  });

  it('should return Unknown error for undefined', () => {
    const result = obtainStreamError(undefined);

    expect(result).to.deep.equal({
      code: StreamError.Unknown,
      message: 'Unknown.',
      original: undefined,
    });
  });
});
