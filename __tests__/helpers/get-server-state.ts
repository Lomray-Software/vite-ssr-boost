import { expect } from 'chai';
import { afterEach, beforeEach, describe, it } from 'vitest';
import getServerState from '@helpers/get-server-state';

describe('getServerState', () => {
  beforeEach(() => {
    // @ts-ignore
    global.window = {};
  });

  afterEach(() => {
    // @ts-ignore
    delete global.window;
  });

  it('should return an empty object if the server state does not exist', () => {
    const result = getServerState('nonexistentState');

    expect(result).to.deep.equal({});
  });

  it('should return the server state and remove it from the window object if it exists', () => {
    const stateName = 'existingState';
    const serverState = { key: 'value' };

    (window as Record<string, any>)[stateName] = serverState;

    const result = getServerState(stateName);

    expect(result).to.deep.equal(serverState);
    expect((window as Record<string, any>)[stateName]).to.be.undefined;
  });

  it('should return the server state without removing it if shouldRemove is false', () => {
    const stateName = 'existingState';
    const serverState = { key: 'value' };

    (window as Record<string, any>)[stateName] = serverState;

    const result = getServerState(stateName, false);

    expect(result).to.deep.equal(serverState);
    expect((window as Record<string, any>)[stateName]).to.deep.equal(serverState);
  });

  it('should handle generic types properly', () => {
    const stateName = 'genericState';
    const serverState: Record<string, number> = { count: 42 };

    (window as Record<string, any>)[stateName] = serverState;

    const result = getServerState<Record<string, number>>(stateName);

    expect(result).to.deep.equal(serverState);
    expect((window as Record<string, any>)[stateName]).to.be.undefined;
  });
});
