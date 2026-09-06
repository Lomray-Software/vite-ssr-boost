// @vitest-environment node
import testCachePolicy from '@__helpers__/cache-policy';
import renderToStream from '@edge/render-to-stream';

testCachePolicy('edge', renderToStream);
