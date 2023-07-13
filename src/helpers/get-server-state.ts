/**
 * Get server state on the client side
 */
const getServerState = (name: string, shouldRemove = true): Record<string, any> => {
  const data = window[name] as Record<string, any>;

  if (shouldRemove && data) {
    delete window[name];
  }

  return data ?? {};
};

export default getServerState;
