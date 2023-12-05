import { promises as dns } from 'node:dns';
import type { AddressInfo, Server } from 'node:net';
import os from 'node:os';
import type { ResolvedServerUrls } from 'vite';

interface IHostname {
  host: string | undefined;
  name: string;
}

const loopbackHosts = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0000:0000:0000:0000:0000:0000:0000:0001',
]);

const wildcardHosts = new Set(['0.0.0.0', '::', '0000:0000:0000:0000:0000:0000:0000:0000']);

/**
 * @see https://github.com/vitejs/vite/blob/main/packages/vite/src/node/utils.ts#LL819C8-L830C2
 */
async function getLocalhostAddressIfDiffersFromDNS(): Promise<string | undefined> {
  const [nodeResult, dnsResult] = await Promise.all([
    dns.lookup('localhost'),
    dns.lookup('localhost', { verbatim: true }),
  ]);
  const isSame = nodeResult.family === dnsResult.family && nodeResult.address === dnsResult.address;

  return isSame ? undefined : nodeResult.address;
}

/**
 * Resolve hostname
 * @see https://github.com/vitejs/vite/blob/main/packages/vite/src/node/utils.ts#LL852C1-L878C2
 * vite not export this function
 */
async function resolveHostname(optionsHost: string | boolean | undefined): Promise<IHostname> {
  let host: string | undefined;

  if (optionsHost === undefined || optionsHost === false) {
    // Use a secure default
    host = 'localhost';
  } else if (optionsHost === true) {
    // If passed --host in the CLI without arguments
    host = undefined; // undefined typically means 0.0.0.0 or :: (listen on all IPs)
  } else {
    host = optionsHost;
  }

  // Set host name to localhost when possible
  let name = host === undefined || wildcardHosts.has(host) ? 'localhost' : host;

  if (host === 'localhost') {
    // See #8647 for more details.
    const localhostAddr = await getLocalhostAddressIfDiffersFromDNS();

    if (localhostAddr) {
      name = localhostAddr;
    }
  }

  return { host, name };
}

interface IResolveServerUrlsOptions {
  host: string;
  isHttps?: boolean;
  rawBase?: string;
}

/**
 * Resolve server urls
 * @see https://github.com/vitejs/vite/blob/main/packages/vite/src/node/utils.ts#L956
 * vite not export this function
 */
async function resolveServerUrls(
  server: Server,
  options: IResolveServerUrlsOptions,
): Promise<ResolvedServerUrls> {
  const address = server.address();

  const isAddressInfo = (x: AddressInfo | null | string): x is AddressInfo =>
    (typeof x === 'object' && Boolean(x?.address)) || false;

  if (!isAddressInfo(address)) {
    return { local: [], network: [] };
  }

  const { host, isHttps, rawBase } = options;

  const local: string[] = [];
  const network: string[] = [];
  const hostname = await resolveHostname(host);
  const protocol = isHttps ? 'https' : 'http';
  const { port } = address;
  const base = rawBase === './' || rawBase === '' || !rawBase ? '/' : rawBase;

  if (hostname.host !== undefined && !wildcardHosts.has(hostname.host)) {
    let hostnameName = hostname.name;

    // ipv6 host
    if (hostnameName.includes(':')) {
      hostnameName = `[${hostnameName}]`;
    }

    const addressUrl = `${protocol}://${hostnameName}:${port}${base}`;

    if (loopbackHosts.has(hostname.host)) {
      local.push(addressUrl);
    } else {
      network.push(addressUrl);
    }
  } else {
    Object.values(os.networkInterfaces())
      .flatMap((nInterface) => nInterface ?? [])
      .filter(
        (detail) =>
          detail &&
          detail.address &&
          (detail.family === 'IPv4' ||
            // @ts-expect-error Node 18.0 - 18.3 returns number
            detail.family === 4),
      )
      .forEach((detail) => {
        let resultHost = detail.address.replace('127.0.0.1', hostname.name);

        // ipv6 host
        if (resultHost.includes(':')) {
          resultHost = `[${resultHost}]`;
        }

        const url = `${protocol}://${resultHost}:${port}${base}`;

        if (detail.address.includes('127.0.0.1')) {
          local.push(url);
        } else {
          network.push(url);
        }
      });
  }

  return { local, network };
}

export default resolveServerUrls;
