import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { afterAll } from 'vitest';

chai.use(sinonChai);

afterAll(() => {
  sinon.restore();
});
