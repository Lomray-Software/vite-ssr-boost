import path from 'node:path';

type TOutputKind = 'entry' | 'chunk' | 'asset';

type TFingerprintMatcher = (file: string, kind: TOutputKind) => boolean;

type TFileNames = string | ((...args: never[]) => string) | undefined;

interface IOutputFileNames {
  entryFileNames?: TFileNames;
  chunkFileNames?: TFileNames;
  assetFileNames?: TFileNames;
}

interface IBuildOutputConfig {
  assetsDir?: string;
  rolldownOptions?: { output?: IOutputFileNames | IOutputFileNames[] };
  rollupOptions?: { output?: IOutputFileNames | IOutputFileNames[] };
}

const KIND_OPTION: Record<TOutputKind, keyof IOutputFileNames> = {
  entry: 'entryFileNames',
  chunk: 'chunkFileNames',
  asset: 'assetFileNames',
};

// Rollup and Rolldown both default to an 8 character content hash.
const DEFAULT_HASH_LENGTH = 8;

const PLACEHOLDER = /\[(name|hash(?::(\d+))?|ext|extname|format)]/g;

/**
 * Turn a file name pattern into a matcher, or nothing when the names it gives carry no hash.
 */
const toMatcher = (pattern: TFileNames): RegExp | undefined => {
  // A function may return any name, so its files are never treated as content-hashed.
  if (typeof pattern !== 'string' || !/\[hash(?::\d+)?]/.test(pattern)) {
    return;
  }

  let source = '';
  let last = 0;

  for (const match of pattern.matchAll(PLACEHOLDER)) {
    source += pattern.slice(last, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    last = match.index + match[0].length;

    const [, token, length] = match;

    if (token === 'name') {
      source += '.+';
    } else if (token === 'ext' || token === 'format') {
      source += '[^/.]+';
    } else if (token === 'extname') {
      source += '(?:\\.[^/.]+)?';
    } else {
      source += `[A-Za-z0-9_-]{${length ?? DEFAULT_HASH_LENGTH}}`;
    }
  }

  source += pattern.slice(last).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`^${source}$`);
};

/**
 * Decide from the client build's output patterns which emitted files carry a content hash.
 * A file counts only when a pattern with a hash placeholder of its kind produces its name.
 */
const createFingerprintMatcher = (build: IBuildOutputConfig = {}): TFingerprintMatcher => {
  const assetsDir = build.assetsDir ?? 'assets';
  const defaults: Record<TOutputKind, string> = {
    entry: path.posix.join(assetsDir, '[name]-[hash].js'),
    chunk: path.posix.join(assetsDir, '[name]-[hash].js'),
    asset: path.posix.join(assetsDir, '[name]-[hash][extname]'),
  };
  const output = (build.rolldownOptions ?? build.rollupOptions)?.output;
  const outputs = Array.isArray(output) ? output : [output ?? {}];
  const matchers = Object.fromEntries(
    (Object.keys(KIND_OPTION) as TOutputKind[]).map((kind) => [
      kind,
      outputs
        .map((options) => toMatcher(options[KIND_OPTION[kind]] ?? defaults[kind]))
        .filter((matcher): matcher is RegExp => Boolean(matcher)),
    ]),
  ) as Record<TOutputKind, RegExp[]>;

  return (file, kind) => matchers[kind].some((matcher) => matcher.test(file));
};

export type { IBuildOutputConfig, TFingerprintMatcher, TOutputKind };

export default createFingerprintMatcher;
