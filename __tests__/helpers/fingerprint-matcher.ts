import { describe, expect, it } from 'vitest';
import createFingerprintMatcher from '@helpers/fingerprint-matcher';

describe('createFingerprintMatcher', () => {
  it('matches the names Vite gives by default', () => {
    const isFingerprinted = createFingerprintMatcher();

    expect(isFingerprinted('assets/index-AbCd1234.js', 'entry')).toBe(true);
    expect(isFingerprinted('assets/About-x_y-9Z0q.js', 'chunk')).toBe(true);
    expect(isFingerprinted('assets/index-AbCd1234.css', 'asset')).toBe(true);
    expect(isFingerprinted('assets/LICENSE-AbCd1234', 'asset')).toBe(true);
    expect(isFingerprinted('assets/index.js', 'entry')).toBe(false);
    expect(isFingerprinted('assets/index-short.js', 'entry')).toBe(false);
    expect(isFingerprinted('other/index-AbCd1234.js', 'entry')).toBe(false);
  });

  it('follows a custom assets directory', () => {
    const isFingerprinted = createFingerprintMatcher({ assetsDir: 'static/build' });

    expect(isFingerprinted('static/build/index-AbCd1234.js', 'entry')).toBe(true);
    expect(isFingerprinted('assets/index-AbCd1234.js', 'entry')).toBe(false);
  });

  it('leaves stable entry names out while hashed chunks stay in', () => {
    const isFingerprinted = createFingerprintMatcher({
      rollupOptions: {
        output: {
          entryFileNames: 'assets/app.js',
          chunkFileNames: 'chunks/[name].[hash:12].js',
          assetFileNames: 'media/[name][extname]',
        },
      },
    });

    expect(isFingerprinted('assets/app.js', 'entry')).toBe(false);
    expect(isFingerprinted('chunks/About.0123456789ab.js', 'chunk')).toBe(true);
    expect(isFingerprinted('chunks/About.01234567.js', 'chunk')).toBe(false);
    expect(isFingerprinted('media/logo.svg', 'asset')).toBe(false);
  });

  it('prefers rolldownOptions and accepts several outputs', () => {
    const isFingerprinted = createFingerprintMatcher({
      rollupOptions: { output: { entryFileNames: '[name]-[hash].js' } },
      rolldownOptions: {
        output: [{ entryFileNames: 'app.js' }, { entryFileNames: 'legacy/[name]-[hash].js' }],
      },
    });

    expect(isFingerprinted('index-AbCd1234.js', 'entry')).toBe(false);
    expect(isFingerprinted('legacy/index-AbCd1234.js', 'entry')).toBe(true);
  });

  it('never trusts a name returned by a function', () => {
    const isFingerprinted = createFingerprintMatcher({
      rollupOptions: { output: { chunkFileNames: () => 'assets/[name]-[hash].js' } },
    });

    expect(isFingerprinted('assets/About-AbCd1234.js', 'chunk')).toBe(false);
  });
});
