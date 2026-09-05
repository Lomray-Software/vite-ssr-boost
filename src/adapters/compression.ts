export type TCompressionFormat = 'deflate' | 'gzip';

export interface ICompressionOptions {
  format?: TCompressionFormat;
}

export type TCompression = boolean | ICompressionOptions;

type TCreateCompressionStream = (
  format: TCompressionFormat,
) => ReadableWritablePair<Uint8Array, BufferSource>;

/**
 * Read the negotiated encoding quality, including wildcard fallbacks.
 */
const getQuality = (header: string, format: TCompressionFormat): number => {
  const values = new Map<string, number>();

  header.split(',').forEach((part) => {
    const [encoding = '', ...params] = part.trim().toLowerCase().split(';');
    const quality = params.find((param) => param.trim().startsWith('q='));
    const parsed = quality ? Number(quality.split('=')[1]) : 1;

    values.set(encoding, Number.isFinite(parsed) ? parsed : 0);
  });

  return values.get(format) ?? values.get('*') ?? 0;
};

/**
 * Include the negotiation header without duplicating existing Vary values.
 */
const appendVary = (headers: Headers, value: string): void => {
  const vary =
    headers
      .get('Vary')
      ?.split(',')
      .map((item) => item.trim().toLowerCase()) ?? [];

  if (!vary.includes('*') && !vary.includes(value.toLowerCase())) {
    headers.append('Vary', value);
  }
};

/**
 * Compress eligible responses using the transport-provided stream implementation.
 */
const compressResponse = (
  request: Request,
  response: Response,
  compression: TCompression = false,
  createStream: TCreateCompressionStream = (format) => new CompressionStream(format),
): Response => {
  if (
    !compression ||
    !response.body ||
    response.bodyUsed ||
    request.method === 'HEAD' ||
    response.status < 200 ||
    [204, 205, 206, 304].includes(response.status) ||
    response.headers.has('Content-Encoding') ||
    response.headers.has('Content-Range') ||
    response.headers.get('Cache-Control')?.toLowerCase().includes('no-transform') ||
    typeof CompressionStream !== 'function'
  ) {
    return response;
  }

  const acceptEncoding = request.headers.get('Accept-Encoding') ?? '';
  const configured = typeof compression === 'object' ? compression.format : undefined;
  const headers = new Headers(response.headers);
  const format = (configured ? [configured] : (['gzip', 'deflate'] as const))
    .map((candidate) => ({ candidate, quality: getQuality(acceptEncoding, candidate) }))
    .filter(({ quality }) => quality > 0)
    .sort((left, right) => right.quality - left.quality)[0]?.candidate;

  appendVary(headers, 'Accept-Encoding');

  if (!format) {
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  headers.delete('Content-Length');
  headers.set('Content-Encoding', format);

  return new Response(response.body.pipeThrough(createStream(format)), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

export default compressResponse;
