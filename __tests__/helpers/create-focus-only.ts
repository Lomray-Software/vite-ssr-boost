import { describe, expect, it } from 'vitest';
import createFocusOnly from '@helpers/create-focus-only';

describe('createFocusOnly', () => {
  it('should detect client-only focus', () => {
    const focus = createFocusOnly('client');

    expect(focus.isOnlyClient()).toBe(true);
    expect(focus.isClient()).toBe(true);
    expect(focus.isServer()).toBe(false);
    expect(focus.isEntrypoint()).toBe(false);
  });

  it('should detect all/app/server focus states', () => {
    expect(createFocusOnly('all').isClient()).toBe(true);
    expect(createFocusOnly('all').isServer()).toBe(true);
    expect(createFocusOnly('app').isClient()).toBe(true);
    expect(createFocusOnly('app').isServer()).toBe(true);
    expect(createFocusOnly('server').isServer()).toBe(true);
    expect(createFocusOnly('server').isClient()).toBe(false);
  });

  it('should detect entrypoint focus', () => {
    expect(createFocusOnly('entrypoint').isEntrypoint()).toBe(true);
    expect(createFocusOnly('entrypoint').isClient()).toBe(false);
    expect(createFocusOnly('entrypoint').isServer()).toBe(false);
  });
});
