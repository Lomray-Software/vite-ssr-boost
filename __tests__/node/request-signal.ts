// @vitest-environment node
import { EventEmitter, getEventListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import createRequestSignal from '@node/request-signal';

describe('request signal', () => {

  /**
   * Complete the signal lifetime without relying on a future garbage collection cycle.
   */
  it('releases Fetch signal followers when a completed request is disposed', () => {
    const req = new EventEmitter();
    const res = Object.assign(new EventEmitter(), { writableEnded: true });
    const { signal, dispose } = createRequestSignal(req as never, res as never);
    const request = new Request('http://localhost/', { signal });
    const onAbort = vi.fn();

    request.signal.addEventListener('abort', onAbort, { once: true });
    expect(getEventListeners(signal, 'abort')).toHaveLength(1);

    dispose();
    dispose();

    expect(request.signal.aborted).toBe(true);
    expect(request.signal.reason).toBeNull();
    expect(onAbort).toHaveBeenCalledOnce();
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    expect(req.listenerCount('aborted')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
  });

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

    expect(requestSignal.signal.reason).toBeInstanceOf(DOMException);
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
