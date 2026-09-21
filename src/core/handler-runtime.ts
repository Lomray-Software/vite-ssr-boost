import type { StaticHandler } from 'react-router';
import Admission, { readSsrMaxConcurrency } from '@core/admission';
import type { IAdmissionOptions } from '@core/admission';
import NotFoundCache from '@core/not-found';
import type { TNotFoundOptions } from '@core/not-found';
import RequestGuard from '@core/request-guard';
import type { IRequestGuardOptions } from '@core/request-guard';
import createSpaShell from '@core/spa-shell';
import SsrPolicy from '@core/ssr-policy';
import type { ISsrPolicy } from '@core/ssr-policy';

export interface IHandlerRuntimeOptions {
  /** Default-on document request validation; false preserves the previous pipeline. */
  requestGuard?: IRequestGuardOptions | false;
  /** Missing-route document behavior. Default: render. */
  notFound?: TNotFoundOptions;
  /** Optional real-render concurrency limit. */
  admission?: IAdmissionOptions;
  /** Route rendering policy. */
  ssr?: ISsrPolicy;
  /** Must match createStaticHandler's basename. */
  basename?: string;
}

/** Shared startup state for adapters whose per-request hooks capture transport metadata. */
class HandlerRuntime {
  /** Default-on request validation. */
  public readonly guard?: RequestGuard;
  /** Optional bounded anonymous 404 cache. */
  public readonly cache?: NotFoundCache;
  /** Absent entirely when no valid limit is configured. */
  public readonly admission?: Admission;
  /** Compiled policy and bot handling. */
  public readonly policy: SsrPolicy;
  /** Reuse the current document template's SPA shell. */
  public readonly spaShell = createSpaShell();
  /** Selected 404 behavior. */
  public readonly notFound: TNotFoundOptions;

  /** Snapshot environment and application options once per handler/entry. */
  public constructor(
    dataRoutes: StaticHandler['dataRoutes'],
    { requestGuard, notFound = 'render', admission, ssr, basename }: IHandlerRuntimeOptions = {},
  ) {
    this.policy = new SsrPolicy(ssr, dataRoutes, basename);
    this.notFound = notFound;
    const limit = readSsrMaxConcurrency() ?? admission?.maxConcurrency;

    if (requestGuard !== false) {
      this.guard = new RequestGuard(dataRoutes, requestGuard, basename);

      if (
        notFound === 'cached' ||
        (typeof notFound === 'object' && !(notFound instanceof Response))
      ) {
        this.cache = new NotFoundCache(notFound === 'cached' ? undefined : notFound);
      }
    }

    if (limit !== undefined) {
      this.admission = new Admission(limit, admission);
    }
  }
}

export default HandlerRuntime;
