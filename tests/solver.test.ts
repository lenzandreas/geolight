import { describe, expect, it } from 'vitest';
import '../src/levels';
import { check, describe as describeLevel, ideaKey } from '../src/level/design';
import type { LevelDef } from '../src/level/schema';
import { solve } from '../src/level/solver';
import { Session } from '../src/game/session';

const base = (extra: Partial<LevelDef>): LevelDef => ({
  schema: 1,
  id: 'test-level',
  name: { en: 'Test', de: 'Test' },
  intro: { en: 'Hint.', de: 'Tipp.' },
  grid: { w: 8, h: 6 },
  entities: [],
  inventory: [],
  ...extra,
});

/** Laser along row 2, ring above the beam: one mirror turns it up. */
const corner = base({
  entities: [
    { type: 'laser', x: 0, y: 2, angle: 0 },
    { type: 'sink', x: 4, y: 0 },
  ],
  inventory: [{ type: 'mirror', count: 1 }],
  solution: [{ type: 'mirror', x: 4, y: 2, angle: 45 }],
});

const winsWith = (level: LevelDef, steps: NonNullable<LevelDef['solution']>) => {
  const s = new Session(level);
  s.applySolution(steps);
  return s.won;
};

describe('solver', () => {
  it('finds every solution of a one-piece level and proves there is no other', () => {
    const r = solve(corner, { maxSolutions: 10 });
    expect(r.exhausted).toBe(true);
    expect(r.solutions.length).toBeGreaterThan(0);
    for (const s of r.solutions) expect(winsWith(corner, s)).toBe(true);
    expect(r.solutions.some((s) => s[0].x === 4 && s[0].y === 2)).toBe(true);
  });

  it('visits each set of placements once', () => {
    // Two mirrors that could be placed in either order: the search must not count both orders.
    const level = base({
      entities: [
        { type: 'laser', x: 0, y: 2, angle: 0 },
        { type: 'sink', x: 7, y: 5 },
      ],
      inventory: [{ type: 'mirror', count: 2 }],
    });
    const r = solve(level, { maxSolutions: 1000, maxNodes: 2e6, allowSpare: true });
    const keys = r.solutions.map((s) => s.map((x) => `${x.x},${x.y},${x.angle}`).sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('skips solutions that carry a spare piece', () => {
    const level = { ...corner, inventory: [{ type: 'filter', count: 1, params: { color: 'white' } }, { type: 'mirror', count: 1 }] };
    const r = solve(level, { maxSolutions: 50 });
    expect(r.solutions.every((s) => s.length === 1)).toBe(true);
    expect(solve(level, { maxSolutions: 50, allowSpare: true }).solutions.some((s) => s.length === 2)).toBe(true);
  });

  it('leaves turnable pieces alone until light reaches them', () => {
    // Four turnable mirrors that no light can reach must not multiply the search.
    const level = base({
      entities: [
        { type: 'laser', x: 0, y: 2, angle: 0 },
        { type: 'wall', x: 2, y: 2 },
        { type: 'sink', x: 7, y: 5 },
        ...[0, 1, 2, 3].map((i) => ({ id: `m${i}`, type: 'mirror', x: 4 + i, y: 4, angle: 0, lock: 'rotate' as const })),
      ],
    });
    const r = solve(level);
    expect(r.exhausted).toBe(true);
    expect(r.nodes).toBeLessThan(10);
  });

  it('turns pre-placed pieces', () => {
    const level = base({
      entities: [
        { type: 'laser', x: 0, y: 2, angle: 0 },
        { type: 'sink', x: 4, y: 0 },
        { id: 'm', type: 'mirror', x: 4, y: 2, angle: 0, lock: 'rotate' },
      ],
    });
    const r = solve(level);
    expect(r.solutions[0]).toEqual([{ id: 'm', x: 4, y: 2, angle: 45 }]);
  });

  it('moves free pieces', () => {
    const level = base({
      entities: [
        { type: 'laser', x: 0, y: 2, angle: 0 },
        { type: 'wall', x: 4, y: 1 },
        { type: 'sink', x: 6, y: 5, params: { required: 0.1 } },
        { id: 'm', type: 'mirror', x: 4, y: 2, angle: 45, lock: 'free' },
      ],
    });
    // Where it stands, the mirror sends the beam into the wall; it has to move to column 6.
    const r = solve(level, { maxSolutions: 20 });
    expect(r.exhausted).toBe(true);
    for (const s of r.solutions) expect(winsWith(level, s)).toBe(true);
    expect(r.solutions.some((s) => s[0].id === 'm' && s[0].x === 6 && s[0].y === 2)).toBe(true);
    const keys = r.solutions.map((s) => JSON.stringify(s));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('hunts: every solution it reports is real, and it needs fewer boards', () => {
    const level = base({
      entities: [
        { type: 'laser', x: 0, y: 2, angle: 0 },
        { type: 'sink', x: 7, y: 2, params: { color: 'red', strict: true, required: 0.3 } },
      ],
      inventory: [{ type: 'filter', count: 1, params: { color: 'red' } }],
    });
    const exact = solve(level, { maxSolutions: 1000 });
    const hunt = solve(level, { maxSolutions: 1000, hunt: true });
    expect(hunt.solutions.length).toBe(1);
    expect(exact.solutions.length).toBeGreaterThan(10);
    for (const s of hunt.solutions) expect(winsWith(level, s)).toBe(true);
    // All of them are the same idea: a red filter somewhere in the beam.
    expect(new Set(exact.solutions.map((s) => ideaKey(level, s))).size).toBe(1);
  });

  it('stops at its time limit', () => {
    const level = base({ grid: { w: 12, h: 9 }, entities: [{ type: 'laser', x: 0, y: 4, angle: 0 }, { type: 'sink', x: 11, y: 0, params: { required: 5 } }], inventory: [{ type: 'mirror', count: 4 }, { type: 'splitter', count: 2 }] });
    const t0 = Date.now();
    const r = solve(level, { maxNodes: Infinity, maxMs: 200 });
    expect(r.exhausted).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('level design tools', () => {
  it('draws the board and lists the beams', () => {
    const text = describeLevel(corner, { place: ['mirror@4,2@45'] });
    expect(text).toContain('RESULT: SOLVED with 1 tray piece(s).');
    expect(text).toContain('L> -- -- -- Mi');
    expect(text).toContain('ends on sink');
  });

  it('places pieces that are not in the tray, and says so', () => {
    const text = describeLevel(corner, { place: ['splitter@4,2@45'] });
    expect(text).toContain("not in the tray");
    expect(text).toContain('RESULT: not solved.');
  });

  it('passes a sound level and rates it gentle', () => {
    const r = check(corner, { ms: 2000 });
    expect(r.ok).toBe(true);
    expect(r.score).toBeLessThan(3);
  });

  it('reports a shortcut below par', () => {
    const level = { ...corner, inventory: [{ type: 'mirror', count: 2 }], solution: [{ type: 'mirror', x: 2, y: 2, angle: 45 }, { type: 'mirror', x: 2, y: 0, angle: 45 }] };
    const r = check(level, { ms: 2000 });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/SHORTCUT|is not needed/);
  });

  it('rejects a level that is solved at the start, has no solution, or breaks its world', () => {
    expect(check({ ...corner, entities: [...corner.entities, { type: 'mirror', x: 4, y: 2, angle: 45 }] }, { ms: 500 }).text).toContain('already solved');
    expect(check({ ...corner, solution: [] }, { ms: 500 }).text).toContain('no "solution"');
    expect(check({ ...corner, entities: [...corner.entities, { type: 'sensor', x: 4, y: 0 }] }, { ms: 500 }).text).toContain('overlaps');
  });
});
