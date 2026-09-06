import { parse } from 'devalue';

type TFrame = ['init', string, boolean] | ['resolve' | 'reject', number, string] | ['shell'];
interface IDeferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** Install before waiting for the document: inline frames may precede the async entry. */
const receiveStream = (): { ready: Promise<unknown> } => {
  const target = window as typeof window & { __ssrBoostStream?: TFrame[] };
  const queue = (target.__ssrBoostStream ??= []);
  const promises = new Map<number, IDeferred>();
  let hasShell = false;
  let isEarly = false;
  let isInitialized = false;
  let state: unknown;
  let resolveReady!: (value: unknown) => void;
  let rejectReady!: (reason: unknown) => void;
  const ready = new Promise<unknown>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  /** Return the same native promise for every occurrence of an identity. */
  const deferred = (id: number): IDeferred => {
    let pending = promises.get(id);

    if (!pending) {
      let resolve!: IDeferred['resolve'];
      let reject!: IDeferred['reject'];
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      void promise.catch(() => undefined);
      pending = { promise, resolve, reject };
      promises.set(id, pending);
    }

    return pending;
  };

  /** Revive native promises synchronously before router creation or a settlement. */
  const value = (payload: string): unknown =>
    parse(payload, {
      SSRBPromise: ([id]: [number]) => deferred(id).promise,
      SSRBObject: (entries: [string, unknown][]) => Object.fromEntries(entries),
      SSRBError: (entries: [string, unknown][]) => {
        const data = Object.fromEntries(entries);
        const error = Object.assign(new Error('Streamed loader/action rejection'), data);

        if (!data.stack) {
          delete error.stack;
        }

        return error;
      },
      SSRBUndefined: () => undefined,
    });

  /** Inline scripts and the buffered queue are processed in document order. */
  queue.push = (...frames): number => {
    for (const frame of frames) {
      try {
        if (frame[0] === 'shell') {
          hasShell = true;
        } else if (frame[0] === 'init') {
          state = value(frame[1]);
          [, , isEarly] = frame;
          isInitialized = true;
        } else {
          deferred(frame[1])[frame[0]](value(frame[2]));
        }

        if (isInitialized && (!isEarly || hasShell)) {
          resolveReady(state);
        }
      } catch (error) {
        rejectReady(error);
        promises.forEach((pending) => pending.reject(error));
      }
    }

    return 0;
  };
  queue.push(...queue.splice(0));
  void ready.catch(() => undefined);

  return { ready };
};

export default receiveStream;
