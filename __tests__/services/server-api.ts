import { describe, expect, it } from 'vitest';
import ServerApi from '@services/server-api';

describe('ServerApi', () => {
  it('should deny index html by default', () => {
    const api = new ServerApi();

    expect(api.hasAccessIndexHtml()).toBe(false);
  });

  it('should toggle index html access', () => {
    const api = new ServerApi();

    api.changeAccessIndexHtml(true);
    expect(api.hasAccessIndexHtml()).toBe(true);

    api.changeAccessIndexHtml(false);
    expect(api.hasAccessIndexHtml()).toBe(false);
  });
});
