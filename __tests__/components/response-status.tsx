import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import ResponseStatus from '@components/response-status';
import type { IServerContext } from '@context/server';
import { ServerProvider } from '@context/server';

describe('ResponseStatus', () => {
  const status = 400;

  it('should change the server response status to the provided value', () => {
    const context = { isServer: true, response: { status: 200 } } as IServerContext;

    render(
      <ServerProvider context={context}>
        <ResponseStatus status={status} />
      </ServerProvider>,
    );

    // Verify that the server response status has been changed
    expect(context.response?.status).to.equal(status);
  });

  it('should not change the server response status when not on the server', () => {
    const context = { isServer: false, response: { status: 200 } } as IServerContext;

    render(
      <ServerProvider context={context}>
        <ResponseStatus status={status} />
      </ServerProvider>,
    );

    // Verify that the server response status has not been changed
    expect(context.response?.status).to.not.equal(status);
  });
});
