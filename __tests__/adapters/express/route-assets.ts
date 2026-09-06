import { describe, expect, it } from 'vitest';
import getRouteAssets from '@adapters/express/route-assets';
import ServerConfig from '@services/server-config';

describe('managed production route assets', () => {
  it('owns the manifest cache per server configuration and restart', async () => {
    const first = ServerConfig.init({ isProd: true }, { root: '/first-build' });
    const second = ServerConfig.init({ isProd: true, isModulePreload: true }, { root: '/second-build' });
    const firstAssets = await getRouteAssets(first);

    expect(await getRouteAssets(first)).toBe(firstAssets);
    expect(await getRouteAssets(second)).not.toBe(firstAssets);
    expect(await getRouteAssets(ServerConfig.init({ isProd: true }, { root: '/first-build' }))).not.toBe(firstAssets);
  });
});
