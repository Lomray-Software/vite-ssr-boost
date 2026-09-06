interface IDeferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

/** Control loader timing without sleeps or a running HTTP server. */
const createDeferred = <T>(): IDeferred<T> => {
  let resolve!: IDeferred<T>['resolve'];
  let reject!: IDeferred<T>['reject'];

  /**
   * Expose settlement controls to the caller.
   */
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  // A test can reject before React Router has finished querying the other loaders.
  void promise.catch(() => undefined);

  return { promise, resolve, reject };
};

export type { IDeferred };

export default createDeferred;
