// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { walkSerializable } from '@services/diagnostics';

class Example {
  public value = 1;
}

class ExampleArray extends Array {}

describe('diagnostics serialization walker', () => {
  it.each([
    [Promise.resolve(1), 'Promise'],
    [() => 1, 'function'],
    [new Map(), 'Map'],
    [new Set(), 'Set'],
    [new WeakMap(), 'WeakMap'],
    [new WeakSet(), 'WeakSet'],
    [1n, 'BigInt'],
    [Symbol('value'), 'Symbol'],
    [new Example(), 'Example'],
    [new ExampleArray(), 'ExampleArray'],
    [new Uint8Array(1), 'Uint8Array'],
  ])('reports %s as %s with its nested key path', (value, name) => {
    const issues: unknown[] = [];
    walkSerializable({ nested: { items: [{ value }] } }, (issue) => issues.push(issue));
    expect(issues).toEqual([
      { path: '$.nested.items[0].value', reason: `${name} is not JSON-serializable` },
    ]);
  });

  it('explains how a Date hydrates', () => {
    const issues: unknown[] = [];
    walkSerializable({ created: new Date('2026-01-01') }, (issue) => issues.push(issue));
    expect(issues).toEqual([{ path: '$.created', reason: 'Date hydrates as a string' }]);
  });

  it('accepts plain data, arrays, null prototypes and shared references', () => {
    const shared = { value: 'same object' };
    const issues: unknown[] = [];
    walkSerializable(
      {
        a: shared,
        b: shared,
        data: [null, undefined, true, false, 0, 1.5, '', 'text', { nested: [1] }],
        empty: Object.create(null),
      },
      (issue) => issues.push(issue),
    );
    expect(issues).toEqual([]);
  });

  it('quotes ambiguous keys and reports every distinct path to shared values', () => {
    const shared = { 'a.b': Symbol('value') };
    const issues: unknown[] = [];
    walkSerializable([shared, shared, { 'quote"': { '': new Set() } }], (issue) =>
      issues.push(issue),
    );
    expect(issues).toEqual([
      { path: '$[0]["a.b"]', reason: 'Symbol is not JSON-serializable' },
      { path: '$[1]["a.b"]', reason: 'Symbol is not JSON-serializable' },
      { path: '$[2]["quote\\\""][""]', reason: 'Set is not JSON-serializable' },
    ]);
  });

  it('reports cycles without recursing forever', () => {
    const value: { self?: unknown } = {};
    value.self = value;
    const issues: unknown[] = [];
    walkSerializable(value, (issue) => issues.push(issue));
    expect(issues).toEqual([
      { path: '$.self', reason: 'a circular reference is not JSON-serializable' },
    ]);
  });
});
