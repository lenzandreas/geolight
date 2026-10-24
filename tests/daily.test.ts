import { describe, expect, it } from 'vitest';
import { registerBuiltins } from '../src/core/entities';
import { Session, starsFor } from '../src/game/session';
import { dailyKey, generateDaily, previousKey } from '../src/level/daily';
import { parseLevel } from '../src/level/validate';

registerBuiltins();

const days = (start: string, n: number): string[] => {
  const out = [start];
  while (out.length < n) out.push(previousKey(out[out.length - 1]));
  return out;
};

describe('daily puzzle', () => {
  it('formats and steps dates', () => {
    expect(dailyKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(previousKey('2026-03-01')).toBe('2026-02-28');
    expect(previousKey('2026-01-01')).toBe('2025-12-31');
  });

  it('is the same for everyone on a given day', () => {
    const a = JSON.stringify(generateDaily('2026-10-24'));
    // Bypass the cache by checking a fresh day twice in different orders.
    expect(JSON.stringify(generateDaily('2026-10-24'))).toBe(a);
    expect(JSON.stringify(generateDaily('2026-10-25'))).not.toBe(a);
  });

  it('produces valid, solvable, non-trivial puzzles every day', () => {
    for (const key of days('2026-12-31', 60)) {
      const level = parseLevel(generateDaily(key));
      expect(new Session(level).won, key).toBe(false);
      const s = new Session(level);
      s.applySolution();
      expect(s.won, key).toBe(true);
      expect(starsFor(s), key).toBe(3);
    }
  });
});
