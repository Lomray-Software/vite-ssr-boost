import type { FC, PropsWithChildren } from 'react';
import React, { useContext } from 'react';

export interface IServerContext {
  response: Response | null;
  isServer: boolean;
}

const initState = {
  response: null,
  isServer: false,
};

/**
 * Server application context
 */
const ServerContext = React.createContext<IServerContext>(initState);

export interface IServerProvider {
  context: Record<string, any>;
}

/**
 * Server application context provider
 * @constructor
 */
const ServerProvider: FC<PropsWithChildren<IServerProvider>> = ({ children, context }) => (
  <ServerContext.Provider value={context as IServerContext} children={children} />
);

const useServerContext = (): IServerContext => useContext(ServerContext);

export { ServerContext, ServerProvider, useServerContext };
