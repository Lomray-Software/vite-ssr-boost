export interface ICachePolicy {
  public?: boolean;
  private?: boolean;
  maxAge?: number;
  sMaxAge?: number;
  staleWhileRevalidate?: number;
  staleIfError?: number;
  noStore?: boolean;
  noCache?: boolean;
  mustRevalidate?: boolean;
  immutable?: boolean;
}

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

  if (policy.public && policy.private) {
    throw new TypeError('Cache policy cannot be both public and private.');
  }

  if (
    (policy.noStore &&
      (policy.public ||
        policy.immutable ||
        [...seconds].some((name) => policy[name as keyof ICachePolicy] !== undefined))) ||
    (policy.private && policy.sMaxAge !== undefined) ||
    (policy.immutable && (policy.noCache || policy.mustRevalidate)) ||
    ((policy.noCache || policy.mustRevalidate) &&
      (policy.staleWhileRevalidate !== undefined || policy.staleIfError !== undefined))
  ) {
    throw new TypeError('Cache policy contains conflicting directives.');
  }

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
