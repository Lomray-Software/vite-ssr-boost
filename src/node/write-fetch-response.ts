import type { Response as ExpressResponse } from 'express';
import { getHeaderEntries, getSetCookieHeaders } from '@core/headers';

const waitForDrain = (res: ExpressResponse): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      res.off('close', onClose);
      res.off('drain', onDrain);
      res.off('error', onError);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('Response closed before drain.'));
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    res.once('close', onClose);
    res.once('drain', onDrain);
    res.once('error', onError);
  });

const writeFetchResponse = async (res: ExpressResponse, response: Response): Promise<void> => {
  res.status(response.status);

  getHeaderEntries(response.headers).forEach(([name, value]) => res.setHeader(name, value));
  getSetCookieHeaders(response.headers).forEach((cookie) => res.appendHeader('Set-Cookie', cookie));

  if (!response.body) {
    res.end();

    return;
  }

  const reader = response.body.getReader();
  const onClose = (): void => {
    if (!res.writableEnded) {
      void reader.cancel();
    }
  };

  res.once('close', onClose);

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      if (!res.write(chunk.value)) {
        await waitForDrain(res);
      }
    }

    res.end();
  } catch (error) {
    res.destroy(error as Error);
  } finally {
    res.off('close', onClose);
  }
};

export default writeFetchResponse;
