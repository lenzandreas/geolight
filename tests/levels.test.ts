import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import { Session, starsFor } from '../src/game/session';
import { solve } from '../src/level/solver';

describe('level pack', () => {
  it('has unique ids', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
  });

  for (const level of LEVELS) {
    describe(level.id, () => {
      it('has German text', () => {
        expect(level.name.de).toBeTruthy();
        if (level.intro) expect(level.intro.de).toBeTruthy();
      });

      it('is not solved at the start', () => {
        expect(new Session(level).won).toBe(false);
      });

      it('is solved by its reference solution with a perfect score', () => {
        const s = new Session(level);
        s.applySolution();
        expect(s.won).toBe(true);
        expect(starsFor(s)).toBe(3);
        // Solving step by step: hints run out exactly when the solution is complete.
        expect(s.nextHint()).toBeNull();
      });

      it('cannot be solved with a single tray piece unless it is a tutorial', () => {
        const pieces = level.solution?.filter((s) => s.type).length ?? 0;
        if (pieces < 2) return;
        const r = solve(level, { maxPieces: 1, maxSolutions: 1 });
        expect(r.solutions).toEqual([]);
      });
    });
  }
});
