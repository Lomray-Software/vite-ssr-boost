import type { StaticHandlerContext } from 'react-router-dom/server';
import serializeErrors from '@helpers/serialize-errors';

/**
 * Build router state
 */
function buildRouterState(context: StaticHandlerContext): string {
  const { loaderData, actionData, errors } = context;
  const routerState = {
    loaderData,
    actionData,
    errors: serializeErrors(errors),
  };
  const json = JSON.stringify(routerState);

  return `<script async>window.__staticRouterHydrationData = ${json};</script>`;
}

export default buildRouterState;
