import { stringify } from 'devalue';
import { isRouteErrorResponse } from 'react-router';
import type { StaticHandlerContext } from 'react-router';
import script, { streamScript } from '@core/script';
import serializeErrors from '@helpers/serialize-errors';
import type Diagnostics from '@services/diagnostics';

interface IPending {
  settled: boolean;
}

/** Preserve route response details without shipping arbitrary error properties. */
const errorProperties = (reason: unknown, diagnostics: boolean): Record<string, unknown> => {
  const value = reason as {
    type?: string;
    init?: ResponseInit;
    message?: string;
    name?: string;
    stack?: string;
    data?: unknown;
  } | null;
  const isResponse = isRouteErrorResponse(reason);
  const isDataError = value?.type === 'DataWithResponseInit';
  const status = isResponse ? reason.status : value?.init?.status;
  const statusText = isResponse ? reason.statusText : value?.init?.statusText;
  const properties: Record<string, unknown> = {
    message:
      value?.message ??
      (isResponse || isDataError
        ? statusText || `Route data error (${status ?? 500})`
        : String(reason)),
    name: value?.name ?? 'Error',
  };

  if (isResponse || isDataError) {
    Object.assign(properties, {
      status: status ?? 500,
      statusText: statusText ?? '',
      data: value?.data,
      internal: false,
    });
  }

  if (diagnostics && value?.stack) {
    properties.stack = value.stack;
  }

  return properties;
};

/**
 * Request-local promise identities and settlements. devalue encodes each frame's
 * value; promise reducers keep settlement scheduling outside the value codec.
 * No React bytes are read here. Nested settlements can introduce further placeholders.
 */
class DataStream {
  public readonly initial: string;
  public readonly done: Promise<void>;
  protected resolveDone!: () => void;
  protected notify?: () => void;
  protected change?: Promise<void>;
  protected readonly identities = new WeakMap<Promise<unknown>, number>();
  protected readonly pending = new Map<number, IPending>();
  protected readonly frames: string[] = [];
  protected initialized = false;
  protected stopped = false;
  protected aborted = false;
  protected nextId = 0;

  public constructor(
    context: StaticHandlerContext,
    protected readonly diagnostics?: Diagnostics,
    protected readonly nonce?: string,
  ) {
    diagnostics?.inspectRouterState(context);
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    try {
      this.initial = this.encodeValue({
        loaderData: context.loaderData,
        actionData: context.actionData,
        errors: serializeErrors(context.errors),
      });
      this.initialized = true;
      this.wake();
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  /** Use the codec's public plugin API, without depending on React Router internals. */
  protected promiseId = (value: unknown): [number] | false => {
    if (value instanceof Promise) {
      let id = this.identities.get(value);

      if (id === undefined) {
        id = this.nextId++;
        this.identities.set(value, id);
        this.pending.set(id, { settled: false });
        const promiseId = id;

        void value.then(
          (result: unknown) => this.settle(promiseId, result, false),
          (error: unknown) => this.settle(promiseId, error, true),
        );

        if (this.aborted) {
          this.settle(id, new Error('SSR loader/action promise aborted before it settled.'), true);
        }
      }

      return [id];
    }

    return false;
  };

  /** Encode one complete value, preserving the codec's built-in value representations. */
  protected encodeValue(value: unknown): string {
    return stringify(value, {
      SSRBPromise: this.promiseId,
      SSRBError: (error: unknown) =>
        (error instanceof Error || isRouteErrorResponse(error)) &&
        Object.entries(errorProperties(error, Boolean(this.diagnostics))),
      SSRBObject: (item: unknown) =>
        Boolean(item && typeof item === 'object' && Object.hasOwn(item, '__proto__')) &&
        Object.entries(item as object),
      SSRBUndefined: (item: unknown) =>
        typeof item === 'function' ||
        typeof item === 'symbol' ||
        Boolean(
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          ![
            Object.prototype,
            null,
            Date.prototype,
            Map.prototype,
            Set.prototype,
            RegExp.prototype,
            Promise.prototype,
            Error.prototype,
          ].includes(Object.getPrototypeOf(item) as object),
        ),
    });
  }

  /** Publish only once, and finish encoding before announcing a settlement. */
  protected settle(id: number, value: unknown, rejected: boolean): void {
    const pending = this.pending.get(id);

    if (!pending || pending.settled || this.stopped) {
      return;
    }

    pending.settled = true;

    if (!rejected) {
      this.diagnostics?.inspectStreamValue(value, id);
    }

    try {
      const payload = this.encodeValue(
        rejected
          ? Object.assign(
              new Error('Streamed loader/action rejection'),
              errorProperties(value, Boolean(this.diagnostics)),
            )
          : value,
      );

      this.frames.push(streamScript([rejected ? 'reject' : 'resolve', id, payload], this.nonce));
    } catch (error) {
      const payload = this.encodeValue(
        new Error(`Cannot serialize streamed value: ${String(error)}`),
      );

      this.frames.push(streamScript(['reject', id, payload], this.nonce));
    } finally {
      this.pending.delete(id);
      this.wake();
    }
  }

  /** Notify a waiting pull and settle completion only after nested values were visited. */
  protected wake(): void {
    this.notify?.();
    this.notify = undefined;
    this.change = undefined;

    if (this.initialized && !this.pending.size) {
      this.resolveDone();
    }
  }

  public get isDone(): boolean {
    return this.initialized && !this.pending.size;
  }

  /** Wait for data, without starting a read from the React stream. */
  public changed(): Promise<void> {
    if (this.frames.length || this.isDone) {
      return Promise.resolve();
    }

    return (this.change ??= new Promise((resolve) => {
      this.notify = resolve;
    }));
  }

  /** Drain completed value frames before delivering a React boundary chunk. */
  public take(): string {
    return this.frames.splice(0).join('');
  }

  /** Publish initialization in the selected shell/footer block to unblock hydration. */
  public state(isEarly: boolean): string {
    const { initial } = this;
    const assignment = 'window.__staticRouterHydrationData = {__ssrBoostStream: true};';

    return (
      script(assignment, this.nonce, true) + streamScript(['init', initial, isEarly], this.nonce)
    );
  }

  /** Reject outstanding placeholders before a timeout closes the HTML response. */
  public abort(): void {
    this.aborted = true;
    let count = 0;

    for (const [id, value] of this.pending) {
      if (!value.settled) {
        count++;
        this.settle(id, new Error('SSR loader/action promise aborted before it settled.'), true);
      }
    }

    if (count) {
      this.diagnostics?.streamAborted(count);
    }
  }

  /** A disconnected client cannot receive scripts; detach request state from late work. */
  public cancel(): void {
    this.stopped = true;
    this.initialized = true;
    this.pending.clear();
    this.frames.length = 0;
    this.wake();
  }
}

export { errorProperties };

export default DataStream;
