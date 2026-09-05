// @vitest-environment node
import testReactCancellation from '@__helpers__/react-cancellation';
import renderToStream from '@node/render-to-stream';

testReactCancellation(renderToStream);
