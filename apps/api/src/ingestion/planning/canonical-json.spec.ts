import { canonicalJson, payloadHash } from './canonical-json';

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('keeps array order', () => {
    expect(canonicalJson(['b', 'a'])).toBe('["b","a"]');
  });
});

describe('payloadHash', () => {
  it('is a 64 character hex string', () => {
    expect(payloadHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not change with key order', () => {
    expect(payloadHash({ b: 1, a: 2 })).toBe(payloadHash({ a: 2, b: 1 }));
  });

  it('changes with array order', () => {
    expect(payloadHash([1, 2])).not.toBe(payloadHash([2, 1]));
  });

  it('changes when a nested value changes', () => {
    expect(payloadHash({ a: { b: 1 } })).not.toBe(payloadHash({ a: { b: 2 } }));
  });
});
