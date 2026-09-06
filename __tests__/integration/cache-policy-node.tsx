// @vitest-environment node
import testCachePolicy from '@__helpers__/cache-policy';
import renderToStream from '@node/render-to-stream';

testCachePolicy('node', renderToStream);
