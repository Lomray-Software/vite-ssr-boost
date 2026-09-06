import type { ITimelineEvent } from '@services/request-timeline';
import type RequestTimeline from '@services/request-timeline';
import { routerState, streamFrames } from './parse-response';
import type { IRouterState, TStreamFrame } from './parse-response';

interface ITestChunk {
  text: string;

  /** Milliseconds since request start when the decoded text became available. */
  at: number;
}

interface ITestCookie {
  name: string;
  value: string;

  /** Lowercase attribute names; flags are true, other values remain strings. */
  attributes: Record<string, string | true>;
}

interface ITestResponseOptions {
  /** Monotonic request start in milliseconds; defaults to construction time. */
  started?: number;
  timeline?: RequestTimeline;
  signal?: AbortSignal;
  onComplete?: () => void;
}

/** A single eager stream reader with repeatable, order-independent assertions. */
class TestResponse {
  /**
   * Retain decoded chunks and their arrival offsets for repeatable assertions.
   */
  protected readonly parts: ITestChunk[] = [];

  /**
   * Share one body-consumption result across all asynchronous assertions.
   */
  protected readonly completed: Promise<void>;

  /**
   * Anchor chunk timing to the start of the request.
   */
  protected readonly started: number;

  /**
   * Begin consuming the response once and retain failures for later assertions.
   */
  public constructor(
    /**
     * Expose the original response and its metadata.
     */
    public readonly response: Response,

    /**
     * Retain request timing, cancellation and completion hooks.
     */
    protected readonly options: ITestResponseOptions = {},
  ) {
    this.started = options.started ?? performance.now();
    this.completed = this.read();
    void this.completed.catch(() => undefined);
  }

  /**
   * Expose the committed HTTP status.
   */
  public get status(): number {
    return this.response.status;
  }

  /**
   * Expose the committed response headers.
   */
  public get headers(): Headers {
    return this.response.headers;
  }

  /**
   * Join the fully consumed response body for repeatable assertions.
   */
  public async text(): Promise<string> {
    await this.completed;

    return this.parts.map((chunk) => chunk.text).join('');
  }

  /** The raw full document, including React boundary instructions and data scripts. */
  public html(): Promise<string> {
    return this.text();
  }

  /**
   * Return isolated chunk observations after body consumption completes.
   */
  public async chunks(): Promise<ITestChunk[]> {
    await this.completed;

    return this.parts.map((chunk) => ({ ...chunk }));
  }

  /**
   * Reconstruct the loader and action state emitted in the document.
   */
  public async routerState(): Promise<IRouterState | undefined> {
    return routerState(await this.text());
  }

  /** Count raw markers: streamed HTML retains them even after replacement scripts arrive. */
  public async pendingBoundaries(): Promise<number> {
    return (await this.text()).split('<!--$?-->').length - 1;
  }

  /**
   * Read validated SSR Boost transport frames in emission order.
   */
  public async streamFrames(): Promise<TStreamFrame[]> {
    return streamFrames(await this.text());
  }

  /** A failed/cancelled read still has a useful diagnostic timeline. */
  public async timeline(): Promise<ITimelineEvent[]> {
    await this.completed.catch(() => undefined);

    return this.options.timeline?.events.map((event) => ({ ...event })) ?? [];
  }

  /** Preserve separate cookies and commas in Expires, without running a browser cookie jar. */
  public cookies(): ITestCookie[] {
    const headers = this.headers as Headers & { getSetCookie?: () => string[] };
    const values =
      headers.getSetCookie?.() ?? headers.get('set-cookie')?.split(/,(?=\s*[^=;,\s]+=)/) ?? [];

    /**
     * Split each cookie into its value and normalized attributes.
     */
    return values.map((cookie) => {
      const [pair, ...attributes] = cookie.split(';');
      const separator = pair.indexOf('=');

      return {
        name: pair.slice(0, separator).trim(),
        value: pair.slice(separator + 1).trim(),

        /**
         * Preserve attribute values and represent valueless flags as true.
         */
        attributes: Object.fromEntries(
          attributes.map((attribute): [string, string | true] => {
            const index = attribute.indexOf('=');

            return index < 0
              ? [attribute.trim().toLowerCase(), true]
              : [attribute.slice(0, index).trim().toLowerCase(), attribute.slice(index + 1).trim()];
          }),
        ),
      };
    });
  }

  /** Decode incrementally so multibyte characters survive arbitrary transport cuts. */
  protected async read(): Promise<void> {
    const reader = this.response.body?.getReader();
    const decoder = new TextDecoder();
    const { signal, onComplete } = this.options;

    /**
     * Cancel the active reader when the request signal aborts.
     */
    const onAbort = (): void => {
      void reader?.cancel(signal?.reason).catch(() => undefined);
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      signal?.throwIfAborted();

      if (reader) {
        while (true) {
          const { done: isDone, value } = await reader.read();

          signal?.throwIfAborted();

          const text = isDone ? decoder.decode() : decoder.decode(value, { stream: true });

          if (text) {
            this.parts.push({ text, at: performance.now() - this.started });
          }

          if (isDone) {
            break;
          }
        }
      }
    } catch (error) {
      await reader?.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader?.releaseLock();
      signal?.removeEventListener('abort', onAbort);
      onComplete?.();
    }
  }
}

export type { ITestChunk, ITestCookie, ITestResponseOptions };

export default TestResponse;
