import { describe, expect, it } from 'vitest';
import stripEntryAsync from '@helpers/strip-entry-async';

describe('stripEntryAsync', () => {
  it('should remove async from the client entry only', () => {
    const html = '<script src="/client.ts" async></script><script src="/other.ts" async></script>';

    expect(stripEntryAsync(html, '/', 'client.ts')).toBe(
      '<script src="/client.ts"></script><script src="/other.ts" async></script>',
    );
  });

  it('should match an entry path with pattern characters literally', () => {
    const html = [
      '<script src="/app/client[web].ts" async></script>',
      '<script src="/app/clientw.ts" async></script>',
    ].join('');

    expect(stripEntryAsync(html, '/app/', 'client[web].ts')).toBe(
      '<script src="/app/client[web].ts"></script><script src="/app/clientw.ts" async></script>',
    );
  });
});
