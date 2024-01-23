import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it } from 'vitest';
import printServerUrls from '@helpers/print-server-urls';

describe('printServerUrls', () => {
  it('should print server URLs with colors and correct formatting', () => {
    const urls = {
      local: ['http://localhost:3000', 'http://localhost:3001'],
      network: ['http://192.168.1.2:3000', 'http://192.168.1.2:3001'],
    };
    const infoSpy = sinon.spy();

    printServerUrls(urls, infoSpy);

    expect(infoSpy.callCount).to.equal(5);
    expect(infoSpy.getCall(0).args[0]).to.include(urls.local[0]);
    expect(infoSpy.getCall(1).args[0]).to.include(urls.local[1]);
    expect(infoSpy.getCall(2).args[0]).to.include(urls.network[0]);
    expect(infoSpy.getCall(3).args[0]).to.include(urls.network[1]);
  });
});
