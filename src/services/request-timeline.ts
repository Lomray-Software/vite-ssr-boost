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
  public readonly events: ITimelineEvent[] = [];
  public readonly started = performance.now();
  protected ended = false;
  protected aborted = false;

  public constructor(protected readonly request: Request) {
    if (request.signal.aborted) {
      this.onAbort();
    } else {
      request.signal.addEventListener('abort', this.onAbort, { once: true });
    }
  }

  protected onAbort = (): void => this.abort(this.request.signal.reason);

  /** Offsets mark completion/emission, not the beginning of a stage. */
  public record(stage: TRequestStage, detail?: Omit<ITimelineEvent, 'stage' | 'at'>): void {
    if (!this.ended) {
      this.events.push({ stage, at: performance.now() - this.started, ...detail });
    }
  }

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
    if (!response.body) {
      this.end();

      return response;
    }

    const reader = response.body.getReader();
    let isStopped = false;
    const finish = (): void => {
      isStopped = true;
      reader.releaseLock();
      this.end();
    };
    const body = new ReadableStream<Uint8Array>(
      {
        cancel: async (reason) => {
          isStopped = true;
          this.abort(reason);

          try {
            await reader.cancel(reason);
          } finally {
            finish();
          }
        },
        pull: async (controller) => {
          try {
            const chunk = await reader.read();

            if (isStopped) {
              return;
            }

            if (chunk.done) {
              finish();
              controller.close();
            } else {
              controller.enqueue(chunk.value);
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
}

/** Keep the constructor, event array and clock reads behind the enablement check. */
const createTimeline = (request: Request, diagnostics: boolean): RequestTimeline | undefined =>
  diagnostics || (typeof process !== 'undefined' && process.env.SSR_BOOST_TIMELINE === '1')
    ? new RequestTimeline(request)
    : undefined;

export { createTimeline };

export type { ITimelineEvent, TRequestStage };

export default RequestTimeline;
