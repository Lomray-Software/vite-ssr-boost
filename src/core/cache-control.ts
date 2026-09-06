export interface ICachePolicy {
  public?: boolean;
  private?: boolean;

  /** Non-negative integer seconds of freshness in any cache. */
  maxAge?: number;

  /** Non-negative integer seconds of freshness in shared caches. */
  sMaxAge?: number;

  /** Non-negative integer seconds to serve stale content during revalidation. */
  staleWhileRevalidate?: number;

  /** Non-negative integer seconds to serve stale content after an error. */
  staleIfError?: number;
  noStore?: boolean;
  noCache?: boolean;
  mustRevalidate?: boolean;
  immutable?: boolean;
}

/**
 * Preserve a stable wire name and output order for each supported directive.
 */
const directives = {
  public: 'public',
  private: 'private',
  maxAge: 'max-age',
  sMaxAge: 's-maxage',
  staleWhileRevalidate: 'stale-while-revalidate',
  staleIfError: 'stale-if-error',
  noStore: 'no-store',
  noCache: 'no-cache',
  mustRevalidate: 'must-revalidate',
  immutable: 'immutable',
} as const;

/**
 * Identify directives that require duration validation.
 */
const seconds = new Set(['maxAge', 'sMaxAge', 'staleWhileRevalidate', 'staleIfError']);

/** Build a deterministic Cache-Control field; durations are non-negative integer seconds. */
const cacheControl = (policy: ICachePolicy): string => {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new TypeError('Cache policy must be an object.');
  }

  for (const [name, value] of Object.entries(policy)) {
    if (!Object.hasOwn(directives, name)) {
      throw new TypeError(`Unknown cache directive: ${name}.`);
    }

    if (value === undefined) {
      continue;
    }

    if (
      seconds.has(name)
        ? typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0
        : typeof value !== 'boolean'
    ) {
      throw new TypeError(`Invalid cache directive: ${name}.`);
    }
  }

  const {
    public: isPublic,
    private: isPrivate,
    noStore: isNoStore,
    immutable: isImmutable,
    sMaxAge,
    noCache: isNoCache,
    mustRevalidate: shouldRevalidate,
    staleWhileRevalidate,
    staleIfError,
  } = policy;

  if (isPublic && isPrivate) {
    throw new TypeError('Cache policy cannot be both public and private.');
  }

  if (
    (isNoStore &&
      (isPublic ||
        isImmutable ||
        [...seconds].some((name) => policy[name as keyof ICachePolicy] !== undefined))) ||
    (isPrivate && sMaxAge !== undefined) ||
    (isImmutable && (isNoCache || shouldRevalidate)) ||
    ((isNoCache || shouldRevalidate) &&
      (staleWhileRevalidate !== undefined || staleIfError !== undefined))
  ) {
    throw new TypeError('Cache policy contains conflicting directives.');
  }

  /**
   * Emit enabled directives in their declared order.
   */
  return Object.entries(directives)
    .flatMap(([name, directive]) => {
      const value = policy[name as keyof ICachePolicy];

      if (value === undefined || value === false) {
        return [];
      }

      return [seconds.has(name) ? `${directive}=${value}` : directive];
    })
    .join(', ');
};

export default cacheControl;
