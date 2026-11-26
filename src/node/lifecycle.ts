import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';

type TNext = (error?: unknown) => void;

type TLifecycleServer = HttpServer | HttpsServer;

type TSignal = 'SIGINT' | 'SIGTERM';

interface IHealthOptions {
  /** Liveness probe: answers 200 while the process can serve at all. */
  livePath?: string;
  /** Readiness probe: answers 200 after prepare and 503 once draining starts. */
  readyPath?: string;
}

interface ILifecycleOptions {
  /** Opt-in health endpoints; `true` uses `/healthz` and `/readyz`. */
  health?: boolean | IHealthOptions;
  /** Active responses get this long to finish before their sockets are destroyed. */
  drainTimeoutMs?: number;
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
  /** Called after the drain with the exit code; the CLI exits the process here. */
  onExit?: (code: number) => void;
}

interface ILifecycle {
  /** Mark the server ready once its handler is prepared. */
  setReady: () => void;
  isReady: () => boolean;
  isDraining: () => boolean;
  /** Connect-compatible middleware answering the configured health paths. */
  health: (req: IncomingMessage, res: ServerResponse, next: TNext) => void;
  /**
   * Stop accepting, finish active responses and resolve once every socket is gone.
   * Upgraded sockets (WebSocket, HMR) are destroyed once no HTTP response is active.
   */
  close: () => Promise<void>;
  /** Route process signals through close(); a second signal destroys remaining sockets. */
  handleSignals: (options?: ISignalOptions) => () => void;
}

const DEFAULT_HEALTH: Required<IHealthOptions> = { livePath: '/healthz', readyPath: '/readyz' };

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
 * Own readiness, health probes, timeouts and a bounded drain for one Node server.
 */
const createLifecycle = (server: TLifecycleServer, options: ILifecycleOptions = {}): ILifecycle => {
  const { drainTimeoutMs = 30000, onDrain, onClose } = options;
  const paths =
    options.health === true
      ? DEFAULT_HEALTH
      : options.health
        ? { ...DEFAULT_HEALTH, ...options.health }
        : undefined;
  let isReady = false;
  let closing: Promise<void> | undefined;
  let activeResponses = 0;
  const upgradedSockets = new Set<Duplex>();

  applyTimeouts(server, options);

  /**
   * Remember sockets handed to an upgrade handler: Node's closeAllConnections never reaches them.
   */
  const trackUpgrade = (_req: IncomingMessage, socket: Duplex): void => {
    upgradedSockets.add(socket);
    socket.once('close', () => upgradedSockets.delete(socket));
  };

  /**
   * Destroy upgraded sockets so server.close() can complete.
   */
  const destroyUpgraded = (): void => {
    upgradedSockets.forEach((socket) => socket.destroy());
    upgradedSockets.clear();
  };

  /**
   * Destroy every socket left, HTTP and upgraded alike.
   */
  const destroyAll = (): void => {
    server.closeAllConnections();
    destroyUpgraded();
  };

  /*
   * Node answers an upgrade request as a plain request while no 'upgrade' listener exists,
   * so the tracker rides along only while the application (Vite HMR, a WebSocket server) owns one.
   */
  if (server.listenerCount('upgrade') > 0) {
    server.prependListener('upgrade', trackUpgrade);
  }

  server.on('newListener', (event: string | symbol, listener: unknown) => {
    if (event === 'upgrade' && listener !== trackUpgrade && server.listenerCount('upgrade') === 0) {
      server.prependListener('upgrade', trackUpgrade);
    }
  });

  server.on('removeListener', (event: string | symbol, listener: unknown) => {
    if (
      event === 'upgrade' &&
      listener !== trackUpgrade &&
      server.listeners('upgrade').every((current) => current === trackUpgrade)
    ) {
      server.off('upgrade', trackUpgrade);
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
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();

      return;
    }

    const isOk = isLive || (isReady && !closing);

    res
      .writeHead(isOk ? 200 : 503, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      })
      .end(req.method === 'HEAD' ? undefined : isOk ? 'ok' : 'unavailable');
  };

  /**
   * Run the drain once; later callers share the same promise.
   */
  const close: ILifecycle['close'] = () => {
    closing ??= new Promise<void>((resolve, reject) => {
      const timer = setTimeout(destroyAll, drainTimeoutMs);

      timer.unref();

      // The executor runs synchronously, so onDrain starts before the server stops listening.
      const drained = new Promise<void>((done) => {
        done(onDrain?.());
      });
      const stopped = new Promise<void>((done, fail) => {
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

      void Promise.allSettled([drained, stopped])
        .then(async (results) => {
          clearTimeout(timer);
          await onClose?.();

          const failure = results.find((result) => result.status === 'rejected');

          if (failure) {
            throw failure.reason;
          }
        })
        .then(resolve, reject);
    });

    return closing;
  };

  /**
   * Drain on the first signal and force the remaining sockets on the next.
   */
  const handleSignals: ILifecycle['handleSignals'] = ({
    signals = ['SIGTERM', 'SIGINT'],
    onExit,
  } = {}) => {
    /**
     * Shared listener for every subscribed signal.
     */
    const onSignal = (): void => {
      if (closing) {
        destroyAll();

        return;
      }

      close().then(
        () => onExit?.(0),
        () => onExit?.(1),
      );
    };

    signals.forEach((signal) => process.on(signal, onSignal));

    return () => signals.forEach((signal) => process.off(signal, onSignal));
  };

  return {
    setReady: () => {
      isReady = true;
    },
    isReady: () => isReady && !closing,
    isDraining: () => Boolean(closing),
    health,
    close,
    handleSignals,
  };
};

export type { IHealthOptions, ILifecycle, ILifecycleOptions, ISignalOptions, TLifecycleServer };

export default createLifecycle;
