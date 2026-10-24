import { describe, expect, it } from 'vitest';
import { Progress } from '../src/game/progress';
import type { KeyValueStore } from '../src/platform/storage';

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
};

describe('progress', () => {
  it('keeps the best result and persists it', () => {
    const kv = memory();
    const p = new Progress(kv);
    expect(p.complete('a', 2, 3)).toBe(true);
    expect(p.complete('a', 1, 4)).toBe(false);
    expect(p.complete('a', 3, 2)).toBe(true);
    expect(new Progress(kv).level('a')).toEqual({ stars: 3, bestPieces: 2 });
  });

  it('unlocks levels in order', () => {
    const p = new Progress(memory());
    const ids = ['a', 'b', 'c'];
    expect(p.isUnlocked(0, ids)).toBe(true);
    expect(p.isUnlocked(1, ids)).toBe(false);
    p.complete('a', 1, 1);
    expect(p.isUnlocked(1, ids)).toBe(true);
    expect(p.isUnlocked(2, ids)).toBe(false);
  });

  it('survives a corrupt save', () => {
    const kv = memory();
    kv.set('geolight.save', '{not json');
    expect(new Progress(kv).data.levels).toEqual({});
  });
});
