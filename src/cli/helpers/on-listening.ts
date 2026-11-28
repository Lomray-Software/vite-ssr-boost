import type { Server } from 'node:net';

/**
 * Run the callback once the server listens: now when it already does, else on its first bind.
 */
const onListening = (server: Server, callback: () => void): void => {
  if (server.listening) {
    callback();
  } else {
    server.once('listening', callback);
  }
};

export default onListening;
