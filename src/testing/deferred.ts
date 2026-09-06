interface IDeferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

/** Control loader timing without sleeps or a running HTTP server. */
const createDeferred = <T>(): IDeferred<T> => {
  let resolve!: IDeferred<T>['resolve'];
  let reject!: IDeferred<T>['reject'];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // A test can reject before React Router has finished querying the other loaders.
  void promise.catch(() => undefined);

  return { promise, resolve, reject };
};

export type { IDeferred };

export default createDeferred;
