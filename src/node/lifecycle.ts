import type { EventEmitter } from 'node:events';
import { errorMonitor } from 'node:events';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import type { Duplex } from 'node:stream';

type TNext = (error?: unknown) => void;

type TLifecycleServer = HttpServer | HttpsServer;

type TSignal = NodeJS.Signals;

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
   * Runs after the readiness grace, beside the socket drain: release what holds
   * long-lived sockets.
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
  /**
   * Checked when a signal arrives, before listeners subscribed earlier run; false leaves that
   * signal to other listeners.
   */
  shouldHandle?: (signal: TSignal) => boolean;
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
   * Bind the server and resolve with its address, rejecting bind errors and a bind that was
   * closed as it landed.
   * Refused while another bind is in flight, before an earlier close() emitted `close`, when the
   * connection count of a stopped server cannot be read, and once close() has started; a bind on
   * a server that is not listening starts a turn later, and a native close() that emits `close`
   * before it starts cancels it;
   * close() waits for a bind in flight, within its deadline.
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

const DEFAULT_SIGNALS: TSignal[] = ['SIGTERM', 'SIGINT'];

/**
 * Bind trackers of each lifecycle, for adapters that call server.listen() themselves.
 */
const bindTrackers = new WeakMap<ILifecycle, () => void>();

/**
 * Brand of the signal listeners of every lifecycle, so two lifecycles never keep moving each
 * other forward. A registry key, because two installed copies of this module share one process.
 */
const SIGNAL_LISTENER = Symbol.for('@lomray/vite-ssr-boost/signal-listener');

/**
 * Whether a process listener belongs to a lifecycle of any loaded copy.
 */
const isSignalListener = (listener: unknown): boolean =>
  typeof listener === 'function' &&
  (listener as unknown as Record<symbol, unknown>)[SIGNAL_LISTENER] === true;

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
 * How long the server may take to finish closing once the deadline destroyed its sockets.
 */
const CLOSE_SETTLE_MS = 250;

/**
 * Stop the server and reject when it is still open a short settle window after the deadline,
 * which destroys every tracked socket and so lets a tracked server close on its own.
 */
const boundedStop = (
  stop: () => Promise<void>,
  deadline: Promise<void>,
  message: string,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let isSettled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /**
     * Settle once and drop the settle timer so it never holds the process.
     */
    const finish = (outcome: () => void): void => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timer);
      outcome();
    };

    stop().then(
      () => finish(resolve),
      (error: unknown) => finish(() => reject(error)),
    );
    void deadline.then(() => {
      if (!isSettled) {
        timer = setTimeout(() => finish(() => reject(new Error(message))), CLOSE_SETTLE_MS);
      }
    });
  });

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
  // Bound at some point and not yet through the native 'close' event.
  let hasListened = server.listening;
  let isClosed = false;
  // stopServer() ran, so a bind that completes later must not keep the port open.
  let isStopped = false;
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

    // A tunnel whose request finished arriving after the stop has nothing left to wait for:
    // the application handler still runs, then the socket goes so the drain can end.
    if (isStopped && activeResponses === 0) {
      process.nextTick(() => {
        upgradedSockets.delete(socket);
        socket.destroy();
      });
    }
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

  server.on('listening', () => {
    hasListened = true;
    isClosed = false;

    // The drain moved past a bind that outlived its deadline: release the port at once.
    if (isStopped) {
      server.close();
      destroyAll();
    }
  });
  server.on('close', () => {
    isClosed = true;
  });

  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  /**
   * Count a response until it closes and close its keep-alive socket once the drain started.
   * Prepended so the header is set before an application listener writes the response.
   * A response handed on from an expectation listener to `request` is counted and released
   * twice, which keeps the count balanced.
   */
  const trackResponse = (_req: IncomingMessage, res: ServerResponse): void => {
    activeResponses += 1;

    // A request listener prepended after the lifecycle may have answered already.
    if (closing && !res.headersSent) {
      res.setHeader('Connection', 'close');
    }

    res.once('finish', () => {
      if (closing) {
        server.closeIdleConnections();
      }
    });
    res.once('close', () => {
      activeResponses -= 1;

      // Tunnels outlive the readiness grace; a stopped server drops them after its last response.
      if (isStopped && activeResponses === 0) {
        destroyUpgraded();
      }
    });
  };

  server.prependListener('request', trackResponse);

  // http.Server typings take only named events, so the generic listeners use the base type.
  const serverEvents: EventEmitter = server;

  /*
   * Node answers these events itself while no listener for them exists, so a tracker rides along
   * only while the application owns one: upgrade and CONNECT hand over a socket (Vite HMR, a
   * WebSocket server, a proxy), checkContinue and checkExpectation a response that never emits
   * `request`.
   */
  const trackers = new Map<string | symbol, typeof trackTunnel | typeof trackResponse>([
    ['upgrade', trackTunnel],
    ['connect', trackTunnel],
    ['checkContinue', trackResponse],
    ['checkExpectation', trackResponse],
  ]);

  trackers.forEach((tracker, event) => {
    if (serverEvents.listenerCount(event) > 0) {
      serverEvents.prependListener(event, tracker);
    }
  });

  server.on('newListener', (event: string | symbol, listener: unknown) => {
    const tracker = trackers.get(event);

    if (tracker && listener !== tracker && serverEvents.listenerCount(event) === 0) {
      serverEvents.prependListener(event, tracker);
    }
  });

  server.on('removeListener', (event: string | symbol, listener: unknown) => {
    const tracker = trackers.get(event);

    if (
      tracker &&
      listener !== tracker &&
      serverEvents.listeners(event).every((current) => current === tracker)
    ) {
      serverEvents.off(event, tracker);
    }
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
   * Wait out a native close() queued before the bind, which the lifecycle may not have seen
   * (one from before the lifecycle, or a repeated close() on a stopped server): its `close`
   * event would otherwise cancel the bind while the port still opens.
   */
  const settleNativeClose = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      let isCancelled = false;

      /**
       * Note a `close` event that landed before the bind started.
       */
      const onEarlyClose = (): void => {
        isCancelled = true;
      };

      server.once('close', onEarlyClose);
      // A close() with no connections emits on the next tick, so it has landed by setImmediate.
      setImmediate(() => {
        server.getConnections((error, count) => {
          server.off('close', onEarlyClose);

          if (isCancelled) {
            reject(new Error('[ssr-boost] the bind was cancelled by close().'));
          } else if (error && !server.listening) {
            // An unknown count is not an empty server: a close() may still wait for connections.
            reject(error);
          } else if (count > 0 && !server.listening) {
            // Connections without a listening port: a close() still waits for them.
            reject(
              new Error('[ssr-boost] listen() was called before the previous close() finished.'),
            );
          } else {
            resolve();
          }
        });
      });
    });

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

    // The pending `close` event of that close() would otherwise cancel this bind as it starts.
    if (hasListened && !server.listening && !isClosed) {
      return Promise.reject(
        new Error('[ssr-boost] listen() was called before the previous close() finished.'),
      );
    }

    isBinding = true;

    /**
     * Start the bind and settle with its outcome.
     */
    const bind = (): Promise<AddressInfo | string | null> =>
      new Promise<AddressInfo | string | null>((resolve, reject) => {
        /**
         * Drop every bind observer, whichever way the bind ended.
         */
        const detach = (): void => {
          server.off('listening', onListening);
          server.off('error', fail);
          server.off('close', onCancel);
        };

        /**
         * Resolve with the bound address, unless an earlier listener already closed the server.
         */
        function onListening(): void {
          if (!server.listening) {
            fail(new Error('[ssr-boost] the server was closed as its bind landed.'));

            return;
          }

          detach();
          hasListened = true;
          resolve(server.address());
        }

        /**
         * Reject with the bind error.
         */
        function fail(error: unknown): void {
          detach();
          reject(error);
        }

        /**
         * A native close() during the host lookup cancels the bind with only a `close` event.
         */
        function onCancel(): void {
          fail(new Error('[ssr-boost] the bind was cancelled by close().'));
        }

        server.once('listening', onListening);
        server.once('error', fail);
        server.once('close', onCancel);

        try {
          server.listen(port, host);
        } catch (error) {
          fail(error);
        }
      });
    let settleBinding!: () => void;

    // close() waits on this, so a rejected bind is still reported to the caller of listen() alone.
    binding = new Promise<void>((resolve) => {
      settleBinding = resolve;
    });

    // Any server that is not listening can carry a close() whose `close` event is still queued.
    return (server.listening ? bind() : settleNativeClose().then(bind)).finally(() => {
      isBinding = false;
      binding = undefined;
      settleBinding();
    });
  };

  /**
   * Hold close() until a bind the caller started natively ends. The bind error is observed
   * through errorMonitor, so an error nobody listens for still crashes the process as in Node.
   */
  const trackBind = (): void => {
    isBinding = true;
    // http.Server typings take only string events, so errorMonitor uses the base type.
    const emitter: EventEmitter = server;

    binding = new Promise<void>((resolve) => {
      /**
       * Stop watching once the bind ended either way.
       */
      const settle = (): void => {
        server.off('listening', settle);
        server.off('close', settle);
        emitter.off(errorMonitor, settle);
        isBinding = false;
        binding = undefined;
        resolve();
      };

      server.on('listening', settle);
      // A native close() during the host lookup cancels the bind with only a `close` event.
      server.on('close', settle);
      emitter.on(errorMonitor, settle);
    });
  };

  /**
   * Stop accepting and resolve once the server released its port and connections.
   */
  const stopServer = (): Promise<void> =>
    new Promise<void>((done, fail) => {
      isStopped = true;

      if (server.listening) {
        server.close((error) => (error ? fail(error) : done()));
      } else if (hasListened && !isClosed) {
        // A native close() already stopped accepting; its connections still run, so join it.
        server.once('close', () => done());
      } else {
        // A native close() before the lifecycle existed leaves no trace but its connections.
        const onNativeClose = (): void => done();

        server.once('close', onNativeClose);
        // An unknown count is not an empty server: the native close or the deadline ends it.
        server.getConnections((error, count) => {
          if (!error && count === 0) {
            server.off('close', onNativeClose);
            done();
          }
        });

        return;
      }

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
    // A bind that never settles (a hanging host lookup) must not hold the drain past its bound.
    if (binding) {
      const pending = binding;

      await withDeadline((deadline) => Promise.race([pending, deadline]));
    }

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
        // A socket upgraded before the lifecycle existed is not tracked, so it can outlive
        // the deadline and keep the server open.
        boundedStop(
          stopServer,
          deadline,
          `[ssr-boost] the server did not close within ${drainTimeoutMs} ms: ` +
            'connections opened before the lifecycle remain.',
        ),
      ]),
    );

    const [closed] = await withDeadline((deadline) =>
      Promise.allSettled([
        bounded(
          onClose,
          deadline,
          `[ssr-boost] onClose did not settle within ${drainTimeoutMs} ms.`,
        ),
      ]),
    );
    // The first failure in phase order wins, so an onClose error never hides a drain error.
    const failure = [...results, closed].find((result) => result.status === 'rejected');

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
   * Drain on the first signal, joining a drain already under way, and force it on the next,
   * unless shouldHandle declines the signal when it arrives.
   */
  const handleSignals: ILifecycle['handleSignals'] = ({
    signals = DEFAULT_SIGNALS,
    onSignal,
    onExit,
    shouldHandle,
  } = {}) => {
    let isSignalled = false;

    /**
     * Shared reaction to every subscribed signal.
     */
    const react = (signal: TSignal): void => {
      if (shouldHandle && !shouldHandle(signal)) {
        return;
      }

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
    const listeners = new Map<string | symbol, () => void>(
      signals.map((signal) => [signal, () => react(signal)]),
    );

    /**
     * Move a listener of ours back to the front after another listener was prepended ahead of it.
     */
    const keepFirst = (event: string | symbol, added: unknown): void => {
      const listener = listeners.get(event);

      if (!listener || added === listener || isSignalListener(added)) {
        return;
      }

      // Node adds the listener after this event, so the move waits for it; a signal is delivered
      // on a later turn of the event loop. A listener the application removed stays removed.
      queueMicrotask(() => {
        const current = process.listeners(event as TSignal);

        if (
          listeners.get(event) !== listener ||
          !current.includes(listener) ||
          current[0] === listener
        ) {
          return;
        }

        process.off(event, listener);
        process.prependListener(event as TSignal, listener);
      });
    };

    // Ahead of earlier listeners, so shouldHandle still sees a process.once handler that Node
    // removes before calling it; it stays first when a later listener is prepended as well.
    listeners.forEach((listener, signal) => {
      Object.defineProperty(listener, SIGNAL_LISTENER, { value: true });
      process.prependListener(signal as TSignal, listener);
    });

    if (shouldHandle) {
      process.on('newListener', keepFirst);
    }

    return () => {
      process.off('newListener', keepFirst);
      listeners.forEach((listener, signal) => {
        process.off(signal, listener);
      });
      listeners.clear();
    };
  };

  const lifecycle: ILifecycle = {
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

  bindTrackers.set(lifecycle, trackBind);

  return lifecycle;
};

/**
 * Let a lifecycle follow a bind started with server.listen() directly, so close() waits for
 * the port within its deadline while the server keeps Node's own bind error semantics.
 */
const trackNativeBind = (lifecycle: ILifecycle): void => {
  bindTrackers.get(lifecycle)?.();
};

export { trackNativeBind };

export type { IHealthOptions, ILifecycle, ILifecycleOptions, ISignalOptions, TLifecycleServer };

export default createLifecycle;
