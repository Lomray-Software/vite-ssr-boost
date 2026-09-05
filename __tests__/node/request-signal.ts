// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import createRequestSignal from '@node/request-signal';

describe('request signal', () => {
  it('recognizes disconnects that happened before rendering started', () => {
    const req = Object.assign(new EventEmitter(), { aborted: true });
    const res = Object.assign(new EventEmitter(), { destroyed: true });
    const requestSignal = createRequestSignal(req as never, res as never);

    expect(requestSignal.signal.aborted).toBe(true);
    requestSignal.dispose();
  });
  it('aborts on client disconnect and removes transport listeners', () => {
    const req = new EventEmitter();
    const res = Object.assign(new EventEmitter(), { writableEnded: false });
    const requestSignal = createRequestSignal(req as never, res as never);

    res.emit('close');

    expect(requestSignal.signal.aborted).toBe(true);

    requestSignal.dispose();

    expect(req.listenerCount('aborted')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
  });

  it('does not abort after a completed response closes', () => {
    const req = new EventEmitter();
    const res = Object.assign(new EventEmitter(), { writableEnded: true });
    const requestSignal = createRequestSignal(req as never, res as never);

    res.emit('close');

    expect(requestSignal.signal.aborted).toBe(false);
    requestSignal.dispose();
  });
});
