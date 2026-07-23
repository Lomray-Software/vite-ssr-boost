import type { Response as ExpressResponse } from 'express';
import type { PipeableStream } from 'react-dom/server';
import buildCustomState from '@helpers/build-custom-state';
import buildRouterState from '@helpers/build-router-state';
import handleResponse from '@helpers/handle-response';
import type { IRenderOptions, IRequestContext } from '@node/render';

interface IWriteResponseParams {
  pipe: PipeableStream['pipe'];
  onShellReady: IRenderOptions['onShellReady'];
  getState: IRenderOptions['getState'];
  statusCode?: number; // default status
}

/**
 * Send response to client
 */
const writeResponse = (context: IRequestContext, params: IWriteResponseParams): void => {
  const { res, didError, serverContext, routerContext, html } = context;
  const { pipe, onShellReady, getState } = params;
  let { statusCode } = params;

  // handle response from server components (navigate, status)
  statusCode = handleResponse(res, serverContext!.response, statusCode);

  if (!statusCode) {
    return;
  }

  // catch close connection from React and write footer
  if (didError) {
    const end = res.end.bind(res) as ExpressResponse['end'];

    res.end = (...args: unknown[]): ExpressResponse => {
      // send second part of app shell
      res.write(modifiedFooter || html.footer);

      // @ts-ignore
      return end(...args);
    };
  }

  res.status(statusCode);
  res.setHeader('content-type', 'text/html');

  const { header: modifiedHeader, footer: modifiedFooter } = onShellReady?.({ context }) ?? {};
  const routerState = buildRouterState(routerContext!);
  const customState = buildCustomState(getState?.({ context }));

  html.footer = routerState + customState + html.footer;

  // send first part of app shell
  res.write(modifiedHeader || html.header);
  // start streaming app
  pipe(res);

  if (!didError) {
    // send second part of app shell
    res.write(modifiedFooter || html.footer);
  }
};

export default writeResponse;
