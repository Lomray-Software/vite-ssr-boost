export interface IConditionalValidators {
  /** Quoted entity tag, optionally prefixed with W/. Must identify the selected representation. */
  etag?: string;

  /** Modification time of the selected representation; must parse as a valid date. */
  lastModified?: string | Date;
}

/**
 * Accept only quoted HTTP entity tags.
 */
const entityTag = /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/;

/**
 * HTTP-date includes the two obsolete wire formats; exclude Date.parse's ISO/year shortcuts.
 */
const httpDate =
  /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;

/**
 * Evaluate GET/HEAD cache validators for an existing successful representation.
 * If-None-Match takes precedence, uses weak comparison, and may contain a list.
 * Call before sending a buffered response; this helper never reads or hashes a stream.
 */
const conditionalRequest = (
  { method, headers: requestHeaders }: Request,
  { etag, lastModified }: IConditionalValidators,
): Response | undefined => {
  if (etag !== undefined && !entityTag.test(etag)) {
    throw new TypeError('ETag must be a quoted entity tag, optionally prefixed with W/.');
  }

  const modified = lastModified === undefined ? undefined : new Date(lastModified).getTime();

  if (modified !== undefined && !Number.isFinite(modified)) {
    throw new TypeError('Last-Modified must be a valid date.');
  }

  if (!['GET', 'HEAD'].includes(method)) {
    return undefined;
  }

  const noneMatch = requestHeaders.get('If-None-Match');
  let hasMatch = false;

  if (noneMatch !== null) {
    /**
     * Commas are legal inside an opaque tag, so splitting on commas is incorrect.
     */
    const list: string[] = noneMatch.match(/(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"|\*/g) ?? [];
    const isValidList =
      /^(?:\*|(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"(?:\s*,\s*(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*")*)$/.test(
        noneMatch,
      );

    hasMatch =
      isValidList &&
      list.some(
        (tag) => tag === '*' || (etag && tag.replace(/^W\//, '') === etag.replace(/^W\//, '')),
      );
  } else if (modified !== undefined) {
    const since = requestHeaders.get('If-Modified-Since');
    const timestamp = since !== null && httpDate.test(since) ? Date.parse(since) : NaN;

    hasMatch =
      Number.isFinite(timestamp) && Math.floor(modified / 1000) <= Math.floor(timestamp / 1000);
  }

  if (!hasMatch) {
    return undefined;
  }

  const headers = new Headers();

  if (etag !== undefined) {
    headers.set('ETag', etag);
  }

  if (modified !== undefined) {
    headers.set('Last-Modified', new Date(modified).toUTCString());
  }

  return new Response(null, { status: 304, headers });
};

export default conditionalRequest;
