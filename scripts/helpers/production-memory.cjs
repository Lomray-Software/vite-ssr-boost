const fs = require('node:fs');
const net = require('node:net');

const originalListen = net.Server.prototype.listen;

/**
 * Identify the listening process without polling or changing application requests.
 */
net.Server.prototype.listen = function (...args) {

  /**
   * Sample memory only when the acceptance runner signals the matching server.
   */
  this.once('listening', () => {
    const address = this.address();
    const { SSR_BOOST_ACCEPTANCE_PORT, SSR_BOOST_ACCEPTANCE_PID, SSR_BOOST_ACCEPTANCE_MEMORY } = process.env;

    if (!address || address.port !== Number(SSR_BOOST_ACCEPTANCE_PORT)) {
      return;
    }

    fs.writeFileSync(SSR_BOOST_ACCEPTANCE_PID, JSON.stringify({ pid: process.pid }));

    /**
     * Report the server's resident memory without forcing garbage collection.
     */
    process.on('SIGUSR2', () => {
      fs.writeFileSync(SSR_BOOST_ACCEPTANCE_MEMORY, JSON.stringify({ pid: process.pid, ...process.memoryUsage() }));
    });
  });

  return originalListen.apply(this, args);
};
