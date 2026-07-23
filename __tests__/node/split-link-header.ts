import { describe, expect, it } from 'vitest';
import splitLinkHeader from '@node/split-link-header';

describe('splitLinkHeader', () => {
  it('splits HTTP Link lists without splitting URI or quoted commas', () => {
    expect(
      splitLinkHeader(
        '</one,a.js>; rel=preload; title="one,two", </two.js>; rel=preload; as=script',
      ),
    ).toEqual(['</one,a.js>; rel=preload; title="one,two"', '</two.js>; rel=preload; as=script']);
  });
});
