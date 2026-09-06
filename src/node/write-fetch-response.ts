import { getHeaderEntries, getSetCookieHeaders } from '@core/headers';
import type { TServerResponse } from '@node/http';

const SET_COOKIE = 'Set-Cookie';

/**
 * Write Fetch status and headers while preserving existing transport cookies.
 */
const writeFetchHeaders = (res: TServerResponse, response: Response): void => {
  res.statusCode = response.status;
  getHeaderEntries(response.headers).forEach(([name, value]) => res.setHeader(name, value));
  const cookies = getSetCookieHeaders(response.headers);

  if (typeof res.appendHeader === 'function') {
    cookies.forEach((cookie) => res.appendHeader(SET_COOKIE, cookie));
  } else if (cookies.length) {
    /**
     * The HTTP/2 compatibility response has setHeader(), but no appendHeader().
     */
    const existing = res.getHeader(SET_COOKIE);
    const previousCookies = Array.isArray(existing) ? existing : [String(existing)];

    res.setHeader(SET_COOKIE, existing ? [...previousCookies, ...cookies] : cookies);
  }
};

/**
 * Wait for response capacity and release listeners on drain, close or failure.
 */
const waitForDrain = (res: TServerResponse): Promise<void> =>
  new Promise((resolve, reject) => {
    /**
     * Remove every listener registered for this drain wait.
     */
    const cleanup = (): void => {
      res.off('close', onClose);
      res.off('drain', onDrain);
      res.off('error', onError);
    };

    /**
     * Stop waiting for drain when the client closes the response.
     */
    const onClose = (): void => {
      cleanup();
      reject(new Error('Response closed before drain.'));
    };

    /**
     * Resume body consumption when the transport has capacity.
     */
    const onDrain = (): void => {
      cleanup();
      resolve();
    };

    /**
     * Release drain listeners before rejecting a transport failure.
     */
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    res.once('close', onClose);
    res.once('drain', onDrain);
    res.once('error', onError);
  });

/**
 * Write the Fetch body with backpressure and cancel unread data on disconnect.
 */
const writeFetchResponse = async (res: TServerResponse, response: Response): Promise<void> => {
  if (res.destroyed || res.writableEnded) {
    await response.body?.cancel();

    return;
  }

  if (!res.headersSent) {
    writeFetchHeaders(res, response);
  }

  if (!response.body || res.req?.method === 'HEAD' || [204, 205, 304].includes(res.statusCode)) {
    await response.body?.cancel();
    res.end();

    return;
  }

  const reader = response.body.getReader();

  /**
   * Cancel unread Fetch bytes when the response is interrupted.
   */
  const onClose = (): void => {
    if (!res.writableEnded) {
      void reader.cancel().catch(() => undefined);
    }
  };

  res.once('close', onClose);

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      if (res.destroyed || res.writableEnded) {
        await reader.cancel();

        return;
      }

      const hasCapacity = res.write(chunk.value);

      /**
       * Express compression buffers otherwise: a gzip header alone is not a usable SSR shell.
       */
      (res as TServerResponse & { flush?: () => void }).flush?.();

      if (!hasCapacity) {
        await waitForDrain(res);
      }
    }

    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);

    if (!res.destroyed) {
      res.destroy(error as Error);
    }
  } finally {
    res.off('close', onClose);
    reader.releaseLock();
  }
};

export { writeFetchHeaders };

export default writeFetchResponse;
