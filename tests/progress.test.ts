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

  it('counts daily streaks', () => {
    const p = new Progress(memory());
    const id = (k: string) => `daily-${k}`;
    const prev = (k: string) => String(Number(k) - 1);
    expect(p.streak('10', id, prev)).toBe(0);
    p.complete('daily-8', 3, 1);
    p.complete('daily-9', 3, 1);
    expect(p.streak('10', id, prev)).toBe(2); // Today still open: the streak lives on.
    p.complete('daily-10', 3, 1);
    expect(p.streak('10', id, prev)).toBe(3);
    expect(p.streak('12', id, prev)).toBe(0);
  });

  it('survives a corrupt save', () => {
    const kv = memory();
    kv.set('geolight.save', '{not json');
    expect(new Progress(kv).data.levels).toEqual({});
  });
});
