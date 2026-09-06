// @vitest-environment node
import testKit from '@__helpers__/testing-kit';
import { createTestHandler } from '../../src/testing/edge';

testKit('edge', createTestHandler);
