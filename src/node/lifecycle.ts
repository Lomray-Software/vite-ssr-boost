import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import type { Duplex } from 'node:stream';

type TNext = (error?: unknown) => void;

type TLifecycleServer = HttpServer | HttpsServer;

type TSignal = 'SIGINT' | 'SIGTERM';

type TTunnelEvent = 'upgrade' | 'connect';

interface IHealthOptions {
  /** Liveness probe: answers 200 while the process can serve at all. */
  livePath?: string;
  /** Readiness probe: answers 200 after prepare and 503 once draining starts. */
  readyPath?: string;
}

interface ILifecycleOptions {
  /** Opt-in health endpoints; `true` uses `/healthz` and `/readyz`. */
  health?: boolean | IHealthOptions;
  /**
   * Bound of each drain phase: active responses with onDrain, then onClose.
   * Past it the remaining sockets are destroyed and a hook still running rejects close().
   */
  drainTimeoutMs?: number;
  /**
   * Keep accepting this long after readiness turns 503, so a load balancer stops routing
   * here before the port closes. 0 (the default) stops accepting at once.
   */
  readinessGraceMs?: number;
  /** Node's keepAliveTimeout; left at the Node default unless set. */
  keepAliveTimeoutMs?: number;
  /** Node's headersTimeout; left at the Node default unless set. */
  headersTimeoutMs?: number;
  /** Node's requestTimeout; left at the Node default unless set. */
  requestTimeoutMs?: number;
  /**
   * Runs as the drain starts, beside it: release what holds long-lived sockets
   * (a Vite dev server terminates its HMR clients here).
   */
  onDrain?: () => Promise<void> | void;
  /** Release resources the server depends on after the drain. */
  onClose?: () => Promise<void> | void;
}

interface ISignalOptions {
  signals?: TSignal[];
  /** Called on every subscribed signal before the lifecycle acts on it. */
  onSignal?: (signal: TSignal) => void;
  /** Called after the drain with the exit code; the CLI exits the process here. */
  onExit?: (code: number) => void;
}

interface ILifecycle {
  /** Mark the server ready once its handler is prepared. */
  setReady: () => void;
  /** Whether readiness answers 200: prepared and not draining. */
  isReady: () => boolean;
  /** Whether close() has started. */
  isDraining: () => boolean;
  /** Connect-compatible middleware answering the configured health paths. */
  health: (req: IncomingMessage, res: ServerResponse, next: TNext) => void;
  /**
   * Bind the server and resolve with its address, rejecting bind errors.
   * Refused while another bind is in flight and once close() has started;
   * close() waits for a bind in flight.
   */
  listen: (port?: number, host?: string) => Promise<AddressInfo | string | null>;
  /**
   * Stop accepting, finish active responses and resolve once every socket is gone.
   * Upgraded and tunnelled sockets are destroyed once no HTTP response is active.
   */
  close: () => Promise<void>;
  /** End the drain now: destroy every socket and stop waiting for onDrain and onClose. */
  force: () => void;
  /** Route process signals through close(); a second signal forces the drain. */
  handleSignals: (options?: ISignalOptions) => () => void;
}

interface IDeadline {
  reached: Promise<void>;
  expire: () => void;
  clear: () => void;
}

const DEFAULT_HEALTH: Required<IHealthOptions> = { livePath: '/healthz', readyPath: '/readyz' };

const TUNNEL_EVENTS = new Set<string | symbol>(['upgrade', 'connect']);

const DEFAULT_SIGNALS: TSignal[] = ['SIGTERM', 'SIGINT'];

/**
 * Apply only the timeouts the caller set, keeping Node defaults otherwise.
 */
const applyTimeouts = (
  server: TLifecycleServer,
  { keepAliveTimeoutMs, headersTimeoutMs, requestTimeoutMs }: ILifecycleOptions,
): void => {
  if (keepAliveTimeoutMs !== undefined) {
    server.keepAliveTimeout = keepAliveTimeoutMs;
  }

  if (headersTimeoutMs !== undefined) {
    server.headersTimeout = headersTimeoutMs;
  }

  if (requestTimeoutMs !== undefined) {
    server.requestTimeout = requestTimeoutMs;
  }
};

/**
 * A timer that can also be expired early. It stays referenced, so a stalled hook on an idle
 * process still reaches its deadline instead of letting the process exit unnoticed.
 */
const createDeadline = (ms: number, onExpire: () => void): IDeadline => {
  let isSettled = false;
  let finish!: () => void;
  const reached = new Promise<void>((resolve) => {
    finish = resolve;
  });

  /**
   * Run the expiry once, whether the timer fired or a caller forced it.
   */
  const expire = (): void => {
    if (isSettled) {
      return;
    }

    isSettled = true;
    clearTimeout(timer);
    onExpire();
    finish();
  };
  const timer = setTimeout(expire, ms);

  return {
    reached,
    expire,

    /**
     * Drop the timer once the phase settled in time.
     */
    clear: () => {
      isSettled = true;
      clearTimeout(timer);
    },
  };
};

/**
 * Run a hook and reject with the given message when the deadline passes first.
 */
const bounded = (
  hook: (() => Promise<void> | void) | undefined,
  deadline: Promise<void>,
  message: string,
): Promise<void> =>
  Promise.race([
    // The executor calls the hook synchronously and turns a thrown error into a rejection.
    new Promise<void>((done) => {
      done(hook?.());
    }),
    deadline.then(() => {
      throw new Error(message);
    }),
  ]);

/**
 * Own readiness, health probes, timeouts, binding and a bounded drain for one Node server.
 */
const createLifecycle = (server: TLifecycleServer, options: ILifecycleOptions = {}): ILifecycle => {
  const { drainTimeoutMs = 30000, readinessGraceMs = 0, onDrain, onClose } = options;
  const paths =
    options.health === true
      ? DEFAULT_HEALTH
      : options.health
        ? { ...DEFAULT_HEALTH, ...options.health }
        : undefined;
  let isPrepared = false;
  let isForced = false;
  let closing: Promise<void> | undefined;
  let binding: Promise<unknown> | undefined;
  let isBinding = false;
  let cancelGrace: (() => void) | undefined;
  let activeResponses = 0;
  const upgradedSockets = new Set<Duplex>();
  const sockets = new Set<Socket>();
  const deadlines = new Set<IDeadline>();

  applyTimeouts(server, options);

  /**
   * Remember sockets handed to an upgrade or CONNECT handler: Node's closeAllConnections never reaches them.
   */
  const trackTunnel = (_req: IncomingMessage, socket: Duplex): void => {
    upgradedSockets.add(socket);
    socket.once('close', () => upgradedSockets.delete(socket));
  };

  /**
   * Destroy upgraded and tunnelled sockets so server.close() can complete.
   */
  const destroyUpgraded = (): void => {
    upgradedSockets.forEach((socket) => socket.destroy());
    upgradedSockets.clear();
  };

  /**
   * Destroy every socket left, HTTP, upgraded and raw alike.
   */
  const destroyAll = (): void => {
    server.closeAllConnections();
    destroyUpgraded();
    sockets.forEach((socket) => socket.destroy());
    sockets.clear();
  };

  /**
   * Whether an event hands its socket to the application.
   */
  const isTunnelEvent = (event: string | symbol): event is TTunnelEvent => TUNNEL_EVENTS.has(event);

  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  /*
   * Node answers an upgrade or CONNECT request itself while no listener for it exists,
   * so the tracker rides along only while the application (Vite HMR, a WebSocket server, a proxy) owns one.
   */
  (['upgrade', 'connect'] as TTunnelEvent[]).forEach((event) => {
    if (server.listenerCount(event) > 0) {
      server.prependListener(event, trackTunnel);
    }
  });

  server.on('newListener', (event: string | symbol, listener: unknown) => {
    if (isTunnelEvent(event) && listener !== trackTunnel && server.listenerCount(event) === 0) {
      server.prependListener(event, trackTunnel);
    }
  });

  server.on('removeListener', (event: string | symbol, listener: unknown) => {
    if (
      isTunnelEvent(event) &&
      listener !== trackTunnel &&
      server.listeners(event).every((current) => current === trackTunnel)
    ) {
      server.off(event, trackTunnel);
    }
  });

  /**
   * Close keep-alive sockets as their responses finish so the drain can complete.
   * Prepended so the header is set before an application listener writes the response.
   */
  server.prependListener('request', (_req: IncomingMessage, res: ServerResponse) => {
    activeResponses += 1;

    if (closing) {
      res.setHeader('Connection', 'close');
    }

    res.once('finish', () => {
      if (closing) {
        server.closeIdleConnections();
      }
    });
    res.once('close', () => {
      activeResponses -= 1;

      if (closing && activeResponses === 0) {
        destroyUpgraded();
      }
    });
  });

  /**
   * Answer probes without touching the application handler.
   */
  const health: ILifecycle['health'] = (req, res, next) => {
    const [pathname] = (req.url ?? '/').split('?', 1);
    const isLive = paths?.livePath === pathname;
    const isReadyProbe = paths?.readyPath === pathname;

    if (!isLive && !isReadyProbe) {
      next();

      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }).end();

      return;
    }

    const isOk = isLive || (isPrepared && !closing);

    res
      .writeHead(isOk ? 200 : 503, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      })
      .end(req.method === 'HEAD' ? undefined : isOk ? 'ok' : 'unavailable');
  };

  /**
   * Bind once, unless the drain has already begun.
   */
  const listen: ILifecycle['listen'] = (port, host) => {
    if (closing) {
      return Promise.reject(new Error('[ssr-boost] listen() was called after close() started.'));
    }

    if (isBinding) {
      return Promise.reject(
        new Error('[ssr-boost] listen() was called while a bind is in flight.'),
      );
    }

    isBinding = true;

    const bound = new Promise<AddressInfo | string | null>((resolve, reject) => {
      /**
       * Settle once and drop the error listener, whichever way the bind ended.
       */
      const fail = (error: unknown): void => {
        server.off('error', fail);
        reject(error);
      };

      server.once('error', fail);

      try {
        server.listen(port, host, () => {
          server.off('error', fail);
          resolve(server.address());
        });
      } catch (error) {
        fail(error);
      }
    }).finally(() => {
      isBinding = false;
    });

    binding = bound.catch(() => undefined);

    return bound;
  };

  /**
   * Stop accepting and resolve once the server released its port and connections.
   */
  const stopServer = (): Promise<void> =>
    new Promise<void>((done, fail) => {
      if (!server.listening) {
        done();

        return;
      }

      server.close((error) => (error ? fail(error) : done()));
      server.closeIdleConnections();

      if (activeResponses === 0) {
        destroyUpgraded();
      }
    });

  /**
   * Keep accepting while readiness answers 503; force() cuts it short.
   */
  const waitGrace = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, readinessGraceMs);

      cancelGrace = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  /**
   * Run one drain phase against its own deadline; expiring it destroys every socket.
   */
  const withDeadline = async <T>(phase: (deadline: Promise<void>) => Promise<T>): Promise<T> => {
    const deadline = createDeadline(drainTimeoutMs, destroyAll);

    deadlines.add(deadline);

    if (isForced) {
      deadline.expire();
    }

    try {
      return await phase(deadline.reached);
    } finally {
      deadline.clear();
      deadlines.delete(deadline);
    }
  };

  /**
   * The drain itself: grace, sockets with onDrain, then onClose, each bounded.
   */
  const runClose = async (): Promise<void> => {
    await binding;

    if (readinessGraceMs > 0 && server.listening && !isForced) {
      await waitGrace();
    }

    const results = await withDeadline((deadline) =>
      Promise.allSettled([
        // onDrain starts first, while the server still listens.
        bounded(
          onDrain,
          deadline,
          `[ssr-boost] onDrain did not settle within ${drainTimeoutMs} ms.`,
        ),
        stopServer(),
      ]),
    );

    await withDeadline((deadline) =>
      bounded(onClose, deadline, `[ssr-boost] onClose did not settle within ${drainTimeoutMs} ms.`),
    );

    const failure = results.find((result) => result.status === 'rejected');

    if (failure) {
      throw failure.reason;
    }
  };

  /**
   * Run the drain once; later callers, onDrain included, share the same promise.
   */
  const close: ILifecycle['close'] = () => {
    if (closing) {
      return closing;
    }

    let settle!: [() => void, (error: unknown) => void];

    // Assigned before any hook runs, so a re-entrant close() or isDraining() sees the drain.
    closing = new Promise<void>((resolve, reject) => {
      settle = [resolve, reject];
    });
    void runClose().then(...settle);

    return closing;
  };

  /**
   * Expire every deadline now, starting the drain when it has not begun.
   */
  const force: ILifecycle['force'] = () => {
    isForced = true;
    cancelGrace?.();
    deadlines.forEach((deadline) => deadline.expire());
    destroyAll();

    if (!closing) {
      close().catch(() => undefined);
    }
  };

  /**
   * Drain on the first signal, joining a drain already under way, and force it on the next.
   */
  const handleSignals: ILifecycle['handleSignals'] = ({
    signals = DEFAULT_SIGNALS,
    onSignal,
    onExit,
  } = {}) => {
    let isSignalled = false;

    /**
     * Shared reaction to every subscribed signal.
     */
    const react = (signal: TSignal): void => {
      onSignal?.(signal);

      if (isSignalled) {
        force();

        return;
      }

      isSignalled = true;
      close().then(
        () => onExit?.(0),
        () => onExit?.(1),
      );
    };
    const listeners = signals.map((signal) => [signal, () => react(signal)] as const);

    listeners.forEach(([signal, listener]) => process.on(signal, listener));

    return () => listeners.forEach(([signal, listener]) => process.off(signal, listener));
  };

  return {
    /**
     * Readiness may answer 200 from now on.
     */
    setReady: () => {
      isPrepared = true;
    },

    /**
     * Prepared and not draining.
     */
    isReady: () => isPrepared && !closing,

    /**
     * close() has started.
     */
    isDraining: () => Boolean(closing),
    health,
    listen,
    close,
    force,
    handleSignals,
  };
};

export type { IHealthOptions, ILifecycle, ILifecycleOptions, ISignalOptions, TLifecycleServer };

export default createLifecycle;
