import { describe, expect, it } from 'vitest';
import { LEVELS, UNLISTED, WORLDS } from '../src/levels';
import { ancestors, featuredPieces, piecesUsed } from '../src/level/worlds';
import { Campaign, OPEN_LEVELS, UNLOCK_AFTER } from '../src/game/campaign';

describe('world structure', () => {
  it('lists every level file exactly once', () => {
    expect(UNLISTED).toEqual([]);
    const ids = WORLDS.flatMap((w) => [...w.levels, ...(w.shadow ? [w.shadow] : [])]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has one root and a unique new piece per world', () => {
    expect(WORLDS.filter((w) => w.parents.length === 0).length).toBe(1);
    const objects = WORLDS.filter((w) => w.object).map((w) => w.object);
    expect(new Set(objects).size).toBe(objects.length);
  });

  it('only lets worlds with several parents go without a new piece', () => {
    for (const w of WORLDS.filter((w) => !w.object)) expect(w.parents.length, w.id).toBeGreaterThanOrEqual(2);
  });

  for (const world of WORLDS) {
    describe(world.id, () => {
      it('has at least 6 levels', () => {
        expect(world.levels.length).toBeGreaterThanOrEqual(6);
      });

      it(world.object ? 'introduces exactly one new piece, which every level uses' : "combines its parents' pieces in every level", () => {
        const known = new Set(WORLDS.filter((w) => ancestors(WORLDS, world.id).has(w.id)).map((w) => w.object));
        if (world.object) known.add(world.object);
        const featured = featuredPieces(WORLDS, world);
        expect(featured.length).toBe(world.object ? 1 : world.parents.length);
        for (const id of world.levels) {
          const used = piecesUsed(LEVELS.find((l) => l.id === id)!);
          for (const piece of featured) expect(used.has(piece), `${id} should use ${piece}`).toBe(true);
          for (const piece of used) expect(known.has(piece), `${id} uses ${piece} before it is introduced`).toBe(true);
        }
      });
    });
  }
});

describe('shadow levels', () => {
  for (const world of WORLDS) {
    it(`${world.id} has one, judged by screens and built from pieces the world knows`, () => {
      const level = LEVELS.find((l) => l.id === world.shadow);
      expect(level, `${world.id} needs a shadow level`).toBeDefined();
      expect(level!.entities.some((e) => e.type === 'screen')).toBe(true);
      expect(level!.entities.some((e) => e.type === 'sink')).toBe(false);
      const known = new Set<string | undefined>(WORLDS.filter((w) => ancestors(WORLDS, world.id).has(w.id)).map((w) => w.object));
      if (world.object) known.add(world.object);
      // A shade is the one piece every shadow level may use.
      known.add('blocker');
      const used = piecesUsed(level!);
      for (const piece of featuredPieces(WORLDS, world)) expect(used.has(piece), `${level!.id} should use ${piece}`).toBe(true);
      for (const piece of used) expect(known.has(piece), `${level!.id} uses ${piece} before it is introduced`).toBe(true);
    });
  }

  const make = (solved: string[]) => new Campaign(WORLDS, LEVELS, (id) => solved.includes(id));
  const root = WORLDS[0];

  it('opens with the child worlds and not before', () => {
    expect(make(root.levels.slice(0, UNLOCK_AFTER - 1)).levelOpen(root.shadow!)).toBe(false);
    expect(make(root.levels.slice(0, UNLOCK_AFTER)).levelOpen(root.shadow!)).toBe(true);
  });

  it('earns a moon but never counts towards progress', () => {
    const before = make(root.levels.slice(0, UNLOCK_AFTER - 1));
    const after = make([...root.levels.slice(0, UNLOCK_AFTER - 1), root.shadow!]);
    expect(before.moon(root)).toBe(false);
    expect(after.moon(root)).toBe(true);
    expect(after.solvedCount(root)).toBe(before.solvedCount(root));
    expect(after.openWorldIds()).toEqual(before.openWorldIds());
  });

  it('is never suggested as the next level', () => {
    const everything = WORLDS.flatMap((w) => w.levels);
    expect(make(everything).next()).toBeUndefined();
    expect(make(root.levels.slice(0, UNLOCK_AFTER)).next(root)?.shadow).toBeFalsy();
  });
});

describe('campaign progression', () => {
  const make = (solved: string[]) => new Campaign(WORLDS, LEVELS, (id) => solved.includes(id));
  const root = WORLDS[0];

  it('opens only the root world and its first levels at the start', () => {
    const c = make([]);
    expect(WORLDS.filter((w) => c.worldOpen(w)).map((w) => w.id)).toEqual([root.id]);
    expect(root.levels.map((id) => c.levelOpen(id))).toEqual(root.levels.map((_, i) => i < OPEN_LEVELS));
    expect(c.next()?.level.id).toBe(root.levels[0]);
  });

  it('lets players skip a level', () => {
    const c = make([root.levels[1]]);
    // Level 0 unsolved, level 1 solved: levels 2 is open as the second open level.
    expect(c.levelOpen(root.levels[2])).toBe(true);
    expect(c.levelOpen(root.levels[3])).toBe(false);
  });

  it('opens child worlds after enough levels of the parent', () => {
    const children = WORLDS.filter((w) => w.parents.includes(root.id));
    expect(children.length).toBeGreaterThan(0);
    const almost = make(root.levels.slice(0, UNLOCK_AFTER - 1));
    expect(children.some((w) => almost.worldOpen(w))).toBe(false);
    const enough = make(root.levels.slice(0, UNLOCK_AFTER));
    expect(children.every((w) => enough.worldOpen(w))).toBe(true);
  });

  it('opens a world with several parents only when every parent is far enough', () => {
    const joint = WORLDS.find((w) => w.parents.length > 1)!;
    expect(joint).toBeDefined();
    // Everything solved except the last parent, which is one short.
    const all = WORLDS.filter((w) => w !== joint).flatMap((w) => w.levels);
    const last = WORLDS.find((w) => w.id === joint.parents[joint.parents.length - 1])!;
    const short = all.filter((id) => !last.levels.slice(UNLOCK_AFTER - 1).includes(id));
    expect(make(short).worldOpen(joint)).toBe(false);
    expect(make(all).worldOpen(joint)).toBe(true);
  });

  it('suggests the next level in the same world first', () => {
    const c = make(root.levels.slice(0, UNLOCK_AFTER));
    expect(c.next(root)?.level.id).toBe(root.levels[UNLOCK_AFTER]);
  });
});
