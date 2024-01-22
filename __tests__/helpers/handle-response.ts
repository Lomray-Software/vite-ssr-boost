import { expect } from 'chai';
import type { Response as ExpressResponse } from 'express';
import sinon from 'sinon';
import { describe, it, afterEach } from 'vitest';
import handleResponse from '@helpers/handle-response';

describe('handleResponse', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should return default status if response is not an instance of Response', () => {
    const res = { redirect: sandbox.stub() };
    const response = { someData: 'data' };
    const defaultStatus = 200;

    const result = handleResponse(
      res as unknown as ExpressResponse,
      response as unknown as Response,
      defaultStatus,
    );

    expect(result).to.equal(defaultStatus);
    expect(res.redirect.notCalled).to.be.true;
  });

  it('should redirect and return undefined if status is between 300 and 399', () => {
    const res = { redirect: sandbox.stub() };
    const response = new Response(null, { status: 302, headers: { Location: '/redirect-path' } });
    const defaultStatus = 200;

    const result = handleResponse(
      res as unknown as ExpressResponse,
      response as unknown as Response,
      defaultStatus,
    );

    expect(result).to.be.undefined;
    expect(res.redirect.calledOnceWithExactly(302, '/redirect-path')).to.be.true;
  });

  it('should return response status if it is not a redirect status', () => {
    const res = { redirect: sandbox.stub() };
    const response = new Response(null, { status: 500 });
    const defaultStatus = 200;

    const result = handleResponse(
      res as unknown as ExpressResponse,
      response as unknown as Response,
      defaultStatus,
    );

    expect(result).to.equal(500);
    expect(res.redirect.notCalled).to.be.true;
  });

  it('should return default status if response status is undefined', () => {
    const res = { redirect: sandbox.stub() };
    const response = new Response(null, {});
    const defaultStatus = 200;

    const result = handleResponse(
      res as unknown as ExpressResponse,
      response as unknown as Response,
      defaultStatus,
    );

    expect(result).to.equal(defaultStatus);
    expect(res.redirect.notCalled).to.be.true;
  });

  it('should return default status if response is null', () => {
    const res = { redirect: sandbox.stub() };
    const response = null;
    const defaultStatus = 200;

    const result = handleResponse(
      res as unknown as ExpressResponse,
      response as unknown as Response,
      defaultStatus,
    );

    expect(result).to.equal(defaultStatus);
    expect(res.redirect.notCalled).to.be.true;
  });
});
