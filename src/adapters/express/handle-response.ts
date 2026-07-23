import type { Response as ExpressResponse } from 'express';
import type { StaticHandlerContext } from 'react-router';

/**
 * Handle router or server context response
 */
const handleResponse = (
  res: ExpressResponse,
  response: Response | StaticHandlerContext | null,
  defaultStatus = 200,
): number | undefined => {
  if (!(response instanceof Response)) {
    return defaultStatus;
  }

  // redirect
  if (response.status >= 300 && response.status < 400) {
    res.redirect(response.status, response.headers.get('Location')!);

    return;
  }

  return response.status ?? defaultStatus;
};

export default handleResponse;
