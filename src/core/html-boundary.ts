/**
 * Track tag, comment and raw-text boundaries across arbitrary React byte chunks.
 * Data scripts may be inserted only after a complete tag, never in a split token
 * or script/style body. This observer neither buffers HTML nor reads ahead.
 */
const htmlBoundary = (): ((chunk: Uint8Array) => boolean) => {
  let mode: 'text' | 'tag' | 'comment' | 'raw' = 'text';
  let token = '';
  let quote = '';
  let raw = '';

  return (chunk) => {
    for (const byte of chunk) {
      const char = String.fromCharCode(byte);

      if (mode === 'raw') {
        token = (token + char).slice(-32);

        if (char === '>' && new RegExp(`</${raw}\\s*>$`, 'i').test(token)) {
          mode = 'text';
          token = '';
          raw = '';
        }
      } else if (mode === 'comment') {
        token = (token + char).slice(-3);

        if (token === '-->') {
          mode = 'text';
          token = '';
        }
      } else if (mode === 'tag') {
        if (token.length < 32) {
          token += char;
        }

        if (token === '<!--') {
          mode = 'comment';
        } else if (quote) {
          if (char === quote) {
            quote = '';
          }
        } else if (char === '"' || char === "'") {
          quote = char;
        } else if (char === '>') {
          raw = /^<(script|style|textarea|title)(?:\s|>)/i.exec(token)?.[1]?.toLowerCase() ?? '';
          mode = raw ? 'raw' : 'text';
          token = '';
        }
      } else if (char === '<') {
        mode = 'tag';
        token = '<';
      }
    }

    return mode === 'text' && chunk[chunk.length - 1] === 62;
  };
};

export default htmlBoundary;
