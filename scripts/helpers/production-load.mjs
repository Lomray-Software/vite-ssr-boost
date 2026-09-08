import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * Consume a complete identity response before reusing its connection.
 */
const requestHome = (origin, agent, userAgent) => new Promise((resolve, reject) => {
  const request = http.get(origin, {
    agent,
    headers: { 'Accept-Encoding': 'identity', 'User-Agent': userAgent },
  });
  const timer = setTimeout(() => request.destroy(new Error('Production load request timed out.')), 10_000);

  /**
   * Stop the deadline when the transport fails or the response is truncated.
   */
  const onError = (error) => {
    clearTimeout(timer);
    reject(error);
  };

  request.once('error', onError);

  /**
   * Reject error pages and encoded bodies instead of accepting an invalid load sample.
   */
  request.once('response', (response) => {
    const { statusCode, headers } = response;

    response.once('error', onError);
    response.once('end', () => {
      clearTimeout(timer);

      try {
        assert.equal(statusCode, 200, 'Production load must return HTTP 200.');
        assert.equal(headers['content-encoding'] ?? 'identity', 'identity');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    response.resume();
  });
});

/**
 * Exercise exactly 10,000 additional home requests at ten keep-alive connections.
 */
const measureProductionLoad = async (origin, userAgent) => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 10 });
  let requests = 0;
  let failure;

  /**
   * Stop scheduling on failure while allowing the other in-flight requests to settle.
   */
  const consume = async () => {
    while (requests < 10_000 && !failure) {
      requests += 1;

      try {
        await requestHome(origin, agent, userAgent);
      } catch (error) {
        failure = error;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: 10 }, consume));

    if (failure) {
      throw failure;
    }
  } finally {
    agent.destroy();
  }
};

export default measureProductionLoad;
