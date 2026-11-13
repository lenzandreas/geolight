/**
 * Progression rules over the world tree. Pure logic over "is this level solved?",
 * so it is testable and independent of storage and UI.
 */
import type { LevelDef } from '../level/schema';
import type { WorldDef } from '../level/worlds';

/** Levels a parent world needs solved before its children open. */
export const UNLOCK_AFTER = 4;
/** Unsolved levels that may be open at once inside a world (lets players skip one). */
export const OPEN_LEVELS = 2;

export interface LevelRef {
  world: WorldDef;
  level: LevelDef;
  /** Position inside the world (0-based); -1 for the world's shadow level. */
  index: number;
  /** The world's optional shadow level. */
  shadow?: boolean;
}

export class Campaign {
  private byWorld = new Map<string, WorldDef>();
  private byLevel = new Map<string, LevelRef>();

  constructor(
    readonly worlds: WorldDef[],
    levels: LevelDef[],
    private solved: (id: string) => boolean,
    /** Open everything (development builds). */
    private unlockAll = false,
  ) {
    const levelById = new Map(levels.map((l) => [l.id, l]));
    for (const w of worlds) {
      this.byWorld.set(w.id, w);
      w.levels.forEach((id, index) => {
        const level = levelById.get(id);
        if (!level) throw new Error(`World ${w.id}: unknown level ${id}`);
        this.byLevel.set(id, { world: w, level, index });
      });
      if (w.shadow) {
        const level = levelById.get(w.shadow);
        if (!level) throw new Error(`World ${w.id}: unknown shadow level ${w.shadow}`);
        this.byLevel.set(w.shadow, { world: w, level, index: -1, shadow: true });
      }
    }
  }

  world(id: string): WorldDef | undefined {
    return this.byWorld.get(id);
  }

  ref(levelId: string): LevelRef | undefined {
    return this.byLevel.get(levelId);
  }

  solvedCount(world: WorldDef): number {
    return world.levels.filter((id) => this.solved(id)).length;
  }

  /** How many solved levels a world needs before its children open. */
  needed(world: WorldDef): number {
    return Math.min(UNLOCK_AFTER, world.levels.length);
  }

  worldOpen(world: WorldDef): boolean {
    if (this.unlockAll) return true;
    return world.parents.every((p) => {
      const parent = this.byWorld.get(p)!;
      return this.worldOpen(parent) && this.solvedCount(parent) >= this.needed(parent);
    });
  }

  /** A world's shadow level opens when its child worlds would: after `needed` regular levels. */
  shadowOpen(world: WorldDef): boolean {
    if (!world.shadow) return false;
    if (this.unlockAll || this.solved(world.shadow)) return true;
    return this.worldOpen(world) && this.solvedCount(world) >= this.needed(world);
  }

  /** Has the world's shadow level been solved (its moon earned)? */
  moon(world: WorldDef): boolean {
    return !!world.shadow && this.solved(world.shadow);
  }

  levelOpen(levelId: string): boolean {
    const ref = this.byLevel.get(levelId);
    if (!ref) return false;
    if (ref.shadow) return this.shadowOpen(ref.world);
    if (this.unlockAll || this.solved(levelId)) return true;
    if (!this.worldOpen(ref.world)) return false;
    const unsolvedBefore = ref.world.levels.slice(0, ref.index).filter((id) => !this.solved(id)).length;
    return unsolvedBefore < OPEN_LEVELS;
  }

  /** The next level to play: first open unsolved level in `prefer`, then in any open world. */
  next(prefer?: WorldDef): LevelRef | undefined {
    const candidates = (w: WorldDef) => w.levels.find((id) => !this.solved(id) && this.levelOpen(id));
    const order = prefer ? [prefer, ...this.worlds.filter((w) => w !== prefer)] : this.worlds;
    for (const w of order) {
      const id = candidates(w);
      if (id) return this.byLevel.get(id);
    }
    return undefined;
  }

  /** Worlds that are open now but were not before (compare with a snapshot of open world ids). */
  openWorldIds(): Set<string> {
    return new Set(this.worlds.filter((w) => this.worldOpen(w)).map((w) => w.id));
  }
}
