const serializeForm = (body: Record<string, unknown>): URLSearchParams => {
  const form = new URLSearchParams();

  Object.entries(body).forEach(([name, value]) => {
    const values = Array.isArray(value) ? value : [value];

    values.forEach((item) => {
      if (item != null && !['string', 'number', 'boolean', 'bigint'].includes(typeof item)) {
        throw new TypeError(
          'Cannot serialize nested or non-primitive URL-encoded fields. Provide the adapter getBody option.',
        );
      }

      form.append(name, item == null ? '' : String(item));
    });
  });

  return form;
};

const serializeBody = (body: unknown, contentType = ''): BodyInit | null => {
  if (body == null) {
    return null;
  }

  if (
    typeof body === 'string' ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof ReadableStream ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return body as BodyInit;
  }

  const mediaType = contentType.split(';')[0]?.trim().toLowerCase();

  if (mediaType === 'application/x-www-form-urlencoded') {
    return serializeForm(body as Record<string, unknown>);
  }

  if (!mediaType || mediaType === 'application/json' || mediaType.endsWith('+json')) {
    return JSON.stringify(body);
  }

  throw new TypeError(
    `Cannot serialize a parsed ${mediaType} body. Provide the adapter getBody option.`,
  );
};

export default serializeBody;
