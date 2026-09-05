// @vitest-environment node
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import { describe, expect, it } from 'vitest';
import releaseConfig from '../release.config.js';

const optionsFor = (name) =>
  releaseConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name)?.[1] ?? {};
const contextFor = (message) => ({
  commits: [{ hash: 'a'.repeat(40), message }],
  cwd: process.cwd(),
  logger: { log: () => undefined },
});

describe('release configuration', () => {
  it.each([
    ['feat!: introduce portable SSR runtime adapters', 'major'],
    ['feat(core)!: change the response contract', 'major'],
    ['fix: handle shell errors\n\nBREAKING CHANGE: return a generic error page', 'major'],
    ['feat: support another adapter', 'minor'],
    ['fix: preserve response cookies', 'patch'],
    ['chore: update development dependencies', null],
  ])('classifies %s as %s', async (message, expected) => {
    await expect(
      analyzeCommits(optionsFor('@semantic-release/commit-analyzer'), contextFor(message)),
    ).resolves.toBe(expected);
  });

  it('includes a squash title with a breaking marker in release notes', async () => {
    const notes = await generateNotes(optionsFor('@semantic-release/release-notes-generator'), {
      ...contextFor('feat!: introduce portable SSR runtime adapters'),
      lastRelease: { gitTag: 'v7.1.0' },
      nextRelease: { gitTag: 'v8.0.0', version: '8.0.0' },
      options: { repositoryUrl: 'https://github.com/Lomray-Software/vite-ssr-boost.git' },
    });

    expect(notes).toContain('BREAKING CHANGES');
    expect(notes).toContain('introduce portable SSR runtime adapters');
  });
});
