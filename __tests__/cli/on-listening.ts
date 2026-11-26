// @vitest-environment node
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import onListening from '@cli/helpers/on-listening';

let servers: Server[] = [];

/**
 * A plain TCP server that is closed after each test.
 */
const create = (): Server => {
  const server = createServer();

  servers.push(server);

  return server;
};

describe('cli/helpers/on-listening', () => {
  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    servers = [];
  });

  it('should run at once for a server that already listens, as the node server does', async () => {
    const server = create();

    await new Promise<void>((resolve) => server.listen(0, resolve));

    const callback = vi.fn();

    onListening(server, callback);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should wait for the bind of a server still binding, as Express is', async () => {
    const server = create();
    const callback = vi.fn();

    onListening(server, callback);
    expect(callback).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => server.listen(0, resolve));

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
