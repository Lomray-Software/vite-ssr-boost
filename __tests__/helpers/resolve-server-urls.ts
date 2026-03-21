import type { NetworkInterfaceInfo } from 'node:os';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import resolveServerUrls from '@helpers/resolve-server-urls';

vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>();

  return {
    ...actual,
    promises: {
      ...actual.promises,
      lookup: vi.fn(),
    },
  };
});

describe('resolveServerUrls', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return empty urls for non-address info server', async () => {
    const server = {
      address: () => 'pipe',
    };

    expect(await resolveServerUrls(server as never, { host: 'localhost' })).toEqual({
      local: [],
      network: [],
    });
  });

  it('should resolve localhost url with dns adjusted hostname', async () => {
    const { promises } = await import('node:dns');
    vi.mocked(promises.lookup)
      .mockResolvedValueOnce({ address: '127.0.0.1', family: 4 } as never)
      .mockResolvedValueOnce({ address: '::1', family: 6 } as never);

    const server = {
      address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 3000 }) satisfies AddressInfo,
    };

    expect(await resolveServerUrls(server as never, { host: 'localhost' })).toEqual({
      local: ['http://localhost:3000/'],
      network: [],
    });
  });

  it('should resolve network url for explicit host and keep rawBase', async () => {
    const server = {
      address: () => ({ address: '10.0.0.1', family: 'IPv4', port: 4000 }) satisfies AddressInfo,
    };

    expect(
      await resolveServerUrls(server as never, {
        host: '10.0.0.1',
        isHttps: true,
        rawBase: '/app/',
      }),
    ).toEqual({
      local: [],
      network: ['https://10.0.0.1:4000/app/'],
    });
  });

  it('should resolve wildcard host through network interfaces', async () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo0: [createInterface('127.0.0.1', 'IPv4')],
      en0: [createInterface('192.168.1.10', 'IPv4'), createInterface('fe80::1', 'IPv6')],
    });

    const server = {
      address: () => ({ address: '0.0.0.0', family: 'IPv4', port: 5173 }) satisfies AddressInfo,
    };

    expect(await resolveServerUrls(server as never, { host: '0.0.0.0', rawBase: './' })).toEqual({
      local: ['http://localhost:5173/'],
      network: ['http://192.168.1.10:5173/'],
    });
  });
});
const createInterface = (address: string, family: 'IPv4' | 'IPv6'): NetworkInterfaceInfo =>
  ({
    address,
    family,
    netmask: family === 'IPv4' ? '255.255.255.0' : 'ffff:ffff:ffff:ffff::',
    internal: address === '127.0.0.1',
    mac: '00:00:00:00:00:00',
    cidr: family === 'IPv4' ? `${address}/24` : `${address}/64`,
    ...(family === 'IPv6' ? { scopeid: 0 } : {}),
  }) as NetworkInterfaceInfo;
