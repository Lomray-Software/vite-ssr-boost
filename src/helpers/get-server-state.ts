/**
 * Get server state on the client side
 */
const getServerState = <TP = Record<string, any>>(name: string, shouldRemove = true): TP => {
  const data = (window as Record<any, any>)[name] as TP;

  if (shouldRemove && data) {
    delete (window as Record<any, any>)[name];
  }

  return (data ?? {}) as TP;
};

export default getServerState;
