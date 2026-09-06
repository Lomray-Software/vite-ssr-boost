type TRequestStage =
  | 'router.query'
  | 'prepare'
  | 'shell.ready'
  | 'state.emitted'
  | 'stream.resolve'
  | 'stream.reject'
  | 'body.end'
  | 'response.end'
  | 'abort';

interface ITimelineEvent {
  stage: TRequestStage;

  /** Milliseconds since the request timeline started. */
  at: number;
  id?: number;
  placement?: 'early' | 'footer';
  reason?: string;
}

/** AbortSignal permits arbitrary reasons; keep structured reasons useful in JSON logs. */
const describeReason = (reason: unknown): string => {
  if (reason instanceof Error) {
    return reason.message;
  }

  if (typeof reason === 'string') {
    return reason;
  }

  try {
    return JSON.stringify(reason) ?? 'Render cancelled';
  } catch {
    return 'Unserializable abort reason';
  }
};

/** Request-local observations; never constructed on the disabled path. */
class RequestTimeline {
  /**
   * Retain observations in emission order.
   */
  public readonly events: ITimelineEvent[] = [];

  /**
   * Anchor event offsets to a monotonic clock.
   */
  public readonly started = performance.now();

  /**
   * Prevent observations after response completion.
   */
  protected ended = false;

  /**
   * Record only the first cancellation reason.
   */
  protected aborted = false;

  /**
   * Observe cancellation from the request's signal.
   */
  public constructor(
    /**
     * Retain request metadata and its cancellation signal.
     */
    protected readonly request: Request,
  ) {
    const { signal } = request;

    if (signal.aborted) {
      this.onAbort();
    } else {
      signal.addEventListener('abort', this.onAbort, { once: true });
    }
  }

  /** Offsets mark completion/emission, not the beginning of a stage. */
  public record(stage: TRequestStage, detail?: Omit<ITimelineEvent, 'stage' | 'at'>): void {
    if (!this.ended) {
      this.events.push({ stage, at: performance.now() - this.started, ...detail });
    }
  }

  /**
   * Attach the first cancellation reason to the timeline.
   */
  public abort(reason?: unknown): void {
    if (!this.aborted) {
      this.aborted = true;
      this.record('abort', { reason: describeReason(reason) });
    }
  }

  /** Emit one JSON line only when explicitly requested in development. */
  public end(): void {
    if (this.ended) {
      return;
    }

    this.record('response.end');
    this.ended = true;
    this.request.signal.removeEventListener('abort', this.onAbort);

    if (
      typeof process !== 'undefined' &&
      process.env.SSR_BOOST_TIMELINE === '1' &&
      process.env.NODE_ENV !== 'production'
    ) {
      console.info(
        JSON.stringify({
          type: 'SSR_BOOST_TIMELINE',
          method: this.request.method,
          path: new URL(this.request.url).pathname,
          timeline: this.events,
        }),
      );
    }
  }

  /** Observe final transformed bytes without reading ahead of the consumer. */
  public response(response: Response): Response {
    const { body: responseBody } = response;

    if (!responseBody) {
      this.end();

      return response;
    }

    const reader = responseBody.getReader();
    let isStopped = false;

    /**
     * Release the stream reader and complete the request timeline.
     */
    const finish = (): void => {
      isStopped = true;
      reader.releaseLock();
      this.end();
    };
    const body = new ReadableStream<Uint8Array>(
      {
        /**
         * Forward consumer cancellation and finish observation.
         */
        cancel: async (reason) => {
          isStopped = true;
          this.abort(reason);

          try {
            await reader.cancel(reason);
          } finally {
            finish();
          }
        },

        /**
         * Forward one chunk at a time and record completion or failure.
         */
        pull: async (controller) => {
          try {
            const { done: isDone, value } = await reader.read();

            if (isStopped) {
              return;
            }

            if (isDone) {
              finish();
              controller.close();
            } else {
              controller.enqueue(value);
            }
          } catch (error) {
            if (!isStopped) {
              this.abort(error);
              finish();
              controller.error(error);
            }
          }
        },
      },
      { highWaterMark: 0 },
    );

    return new Response(body, response);
  }

  /**
   * Forward request cancellation without losing the timeline receiver.
   */
  protected onAbort = (): void => this.abort(this.request.signal.reason);
}

/** Keep the constructor, event array and clock reads behind the enablement check. */
const createTimeline = (request: Request, diagnostics: boolean): RequestTimeline | undefined =>
  diagnostics || (typeof process !== 'undefined' && process.env.SSR_BOOST_TIMELINE === '1')
    ? new RequestTimeline(request)
    : undefined;

export { createTimeline };

export type { ITimelineEvent, TRequestStage };

export default RequestTimeline;
