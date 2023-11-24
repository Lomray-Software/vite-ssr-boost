import { expect } from 'chai';
import serializeErrors from '@helpers/serialize-errors';

describe('serializeErrors', () => {
  it('should serialize route errors', () => {
    const errors = {
      error1: new Error('Test error 1'),
      error2: new Error('Test error 2'),
      routeError: {
        name: 'RouteError',
        message: 'Route error message',
        status: 404,
        statusText: 'Status text',
        internal: true,
        data: { test: 1 },
      },
    };

    const result = serializeErrors(errors);

    expect(result).to.deep.equal({
      error1: { message: 'Test error 1', __type: 'Error' },
      error2: { message: 'Test error 2', __type: 'Error' },
      routeError: {
        name: 'RouteError',
        message: 'Route error message',
        status: 404,
        statusText: 'Status text',
        __type: 'RouteErrorResponse',
        data: {
          test: 1,
        },
        internal: true,
      },
    });
  });

  it('should handle null errors', () => {
    const result = serializeErrors(null);

    expect(result).to.equal(null);
  });

  it('should handle undefined errors', () => {
    const result = serializeErrors(undefined as never);

    expect(result).to.equal(null);
  });

  it('should handle errors without serialization', () => {
    const errors = {
      simpleError: 'This is not an Error object',
      anotherError: 42,
    };

    const result = serializeErrors(errors);

    expect(result).to.deep.equal({
      simpleError: 'This is not an Error object',
      anotherError: 42,
    });
  });
});
