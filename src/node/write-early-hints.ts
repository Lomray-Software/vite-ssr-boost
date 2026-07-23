import type { ServerResponse } from 'node:http';
import { getHeaderEntries } from '@core/headers';
import splitLinkHeader from '@node/split-link-header';

const writeEarlyHints = (res: ServerResponse, headers: Headers): void => {
  if (res.headersSent || typeof res.writeEarlyHints !== 'function') {
    return;
  }

  const hints: Record<string, string | string[]> = Object.fromEntries(getHeaderEntries(headers));
  const link = headers.get('Link');

  if (link) {
    hints.link = splitLinkHeader(link);
  }

  if (Object.keys(hints).length) {
    res.writeEarlyHints(hints);
  }
};

export default writeEarlyHints;
