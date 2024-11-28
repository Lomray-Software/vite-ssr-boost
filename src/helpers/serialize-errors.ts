import { isRouteErrorResponse } from 'react-router';
import type { StaticHandlerContext } from 'react-router';

/**
 * Serialize react router errors
 * @see https://github.com/remix-run/react-router/blob/main/packages/react-router-dom/server.tsx#LL166C1-L188C2
 * https://github.com/remix-run/react-router/blob/main/LICENSE.md
 */
function serializeErrors(errors: StaticHandlerContext['errors']): StaticHandlerContext['errors'] {
  if (!errors) {
    return null;
  }

  const entries = Object.entries(errors);
  const serialized: StaticHandlerContext['errors'] = {};
  for (const [key, val] of entries) {
    // Hey you!  If you change this, please change the corresponding logic in
    // deserializeErrors in react-router-dom/index.tsx :)
    if (isRouteErrorResponse(val)) {
      serialized[key] = { ...val, __type: 'RouteErrorResponse' };
    } else if (val instanceof Error) {
      // Do not serialize stack traces from SSR for security reasons
      serialized[key] = {
        message: val.message,
        __type: 'Error',
      };
    } else {
      serialized[key] = val as unknown;
    }
  }

  return serialized;
}

export default serializeErrors;
