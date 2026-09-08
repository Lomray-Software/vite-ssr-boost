// @vitest-environment node
import http from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import measureProductionLoad from '../../scripts/helpers/production-load.mjs';

describe('production load measurement', () => {

  /**
   * Verify the fixed workload consumes bodies and reuses no more than ten connections.
   */
  it('completes exactly 10,000 home responses', async () => {
    let requests = 0;
    let connections = 0;
    const server = http.createServer((request, response) => {
      const { url, headers } = request;

      expect(url).toBe('/');
      expect(headers['accept-encoding']).toBe('identity');
      expect(headers['user-agent']).toBe('acceptance-browser');
      requests += 1;
      response.end('home');
    });

    server.on('connection', () => { connections += 1; });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
      await measureProductionLoad(`http://127.0.0.1:${server.address().port}`, 'acceptance-browser');
      expect(requests).toBe(10_000);
      expect(connections).toBe(10);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  /**
   * Stop the load and report an error page instead of recording a misleading RSS sample.
   */
  it('rejects HTTP failures and stops scheduling requests', async () => {
    let requests = 0;
    const server = http.createServer((_, response) => {
      requests += 1;
      response.writeHead(500).end('failure');
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
      await expect(measureProductionLoad(`http://127.0.0.1:${server.address().port}`, 'acceptance-browser')).rejects.toThrow(
        /Production load must return HTTP 200/,
      );
      expect(requests).toBeLessThanOrEqual(10);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
