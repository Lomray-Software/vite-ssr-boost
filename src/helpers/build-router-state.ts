import type { StaticHandlerContext } from 'react-router';
import htmlEscape from '@helpers/html-escape';
import serializeErrors from '@helpers/serialize-errors';
import type Diagnostics from '@services/diagnostics';

/**
 * Build router state
 */
function buildRouterState(context: StaticHandlerContext, diagnostics?: Diagnostics): string {
  diagnostics?.inspectRouterState(context);

  const { loaderData, actionData, errors } = context;
  const routerState = {
    loaderData,
    actionData,
    errors: serializeErrors(errors),
  };
  const json = htmlEscape(JSON.stringify(JSON.stringify(routerState)));

  return `<script async>window.__staticRouterHydrationData = JSON.parse(${json});</script>`;
}

export default buildRouterState;
