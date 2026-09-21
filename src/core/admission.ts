export interface IAdmissionEvent {
  /** Admission or terminal render outcome. */
  outcome: 'admitted' | 'rejected' | 'finish' | 'abort' | 'error';
  /** Slots still occupied after this event. */
  active: number;
  /** Elapsed monotonic time for a terminal outcome. */
  durationMs?: number;
}

export interface IAdmissionOptions {
  /** Positive safe integer; a valid SSR_MAX_CONCURRENCY overrides this value. */
  maxConcurrency?: number;
  /** Respond immediately at capacity. Default: reject. */
  overload?: 'reject' | 'spa';
  /** Best-effort lifecycle observation. */
  onEvent?: (event: IAdmissionEvent) => void;
}

export interface IAdmissionSlot {
  /** Release exactly once, including races between abort and stream completion. */
  release: (outcome: 'finish' | 'abort' | 'error') => void;
  /** Observe the final response stream under consumer backpressure. */
  response: (response: Response) => Response;
}

/** Invalid or absent environment values leave admission disabled. */
export const resolveSsrMaxConcurrency = (value?: string): number | undefined => {
  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

/** Read process defensively; Workers may have no process or env object. */
export const readSsrMaxConcurrency = (): number | undefined => {
  try {
    return resolveSsrMaxConcurrency(globalThis.process?.env?.SSR_MAX_CONCURRENCY);
  } catch {
    return undefined;
  }
};

/** Bound real React renders without a queue or work on the disabled path. */
class Admission {
  /** Currently occupied render slots. */
  protected activeCount = 0;

  /** Snapshot the concurrency limit and overload policy at startup. */
  public constructor(
    /** Maximum simultaneously occupied slots. */
    protected readonly limit: number,
    /** Startup overload behavior and observation hook. */
    protected readonly options: IAdmissionOptions = {},
  ) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('SSR concurrency limit must be a positive integer.');
    }
  }

  /** Expose occupancy for diagnostics and tests. */
  public get activeRequests(): number {
    return this.activeCount;
  }

  /** Select the immediate overload response. */
  public get overload(): 'reject' | 'spa' {
    return this.options.overload ?? 'reject';
  }

  /** Acquire immediately before React starts, without queuing excess work. */
  public tryAcquire(signal?: AbortSignal): IAdmissionSlot | undefined {
    if (this.activeCount >= this.limit) {
      this.emit({ outcome: 'rejected', active: this.activeCount });

      return undefined;
    }

    const started = performance.now();
    let isReleased = false;

    this.activeCount += 1;
    this.emit({ outcome: 'admitted', active: this.activeCount });

    /** Preserve the first terminal event. */
    const release: IAdmissionSlot['release'] = (outcome) => {
      if (isReleased) {
        return;
      }

      isReleased = true;
      signal?.removeEventListener('abort', onAbort);
      this.activeCount -= 1;
      this.emit({ outcome, active: this.activeCount, durationMs: performance.now() - started });
    };

    /** Release on a disconnected request even before the consumer starts reading. */
    const onAbort = (): void => release('abort');

    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }

    return {
      release,
      /** Read no further than the response consumer requests. */
      response: (response) => {
        if (!response.body) {
          release('finish');

          return response;
        }

        const reader = response.body.getReader();
        let isStopped = false;
        const body = new ReadableStream<Uint8Array>(
          {
            /** Forward cancellation and release even if upstream cancellation fails. */
            cancel: async (reason) => {
              isStopped = true;
              release('abort');

              try {
                await reader.cancel(reason);
              } finally {
                reader.releaseLock();
              }
            },
            /** Observe completion and stream errors after all HTML transforms. */
            pull: async (controller) => {
              try {
                const { done: isDone, value } = await reader.read();

                if (isStopped) {
                  return;
                }

                if (isDone) {
                  isStopped = true;
                  reader.releaseLock();
                  release('finish');
                  controller.close();
                } else {
                  controller.enqueue(value);
                }
              } catch (error) {
                if (!isStopped) {
                  isStopped = true;
                  reader.releaseLock();
                  release('error');
                  controller.error(error);
                }
              }
            },
          },
          { highWaterMark: 0 },
        );

        return new Response(body, response);
      },
    };
  }

  /** Minimal overload response, including HEAD semantics. */
  public reject(request: Request): Response {
    return new Response(request.method === 'HEAD' ? null : 'Service Unavailable', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'Retry-After': '1',
      },
    });
  }

  /** Instrumentation must not interrupt rendering or release. */
  protected emit(event: IAdmissionEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch {
      /** Admission reporting is best effort. */
    }
  }
}

export default Admission;
