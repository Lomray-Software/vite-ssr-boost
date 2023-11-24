/* eslint-disable import/prefer-default-export */
// noinspection JSUnusedGlobalSymbols

import sinon from 'sinon';

/**
 * Mocha root hooks
 */
export const mochaHooks = {
  afterAll(): void {
    sinon.restore();
  },
};
