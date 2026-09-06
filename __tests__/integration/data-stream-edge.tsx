// @vitest-environment node
import testDataStream from '@__helpers__/data-stream';
import renderToStream from '@edge/render-to-stream';

// React 18's Node and Web Fizz renderers must not share a React context instance.
testDataStream('edge', renderToStream);
