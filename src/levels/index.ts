/**
 * Built-in level pack. Levels live in one folder per world; their order and the
 * world tree are defined in worlds.json. Further packs (user levels, daily
 * puzzles) can provide LevelDef arrays from other sources.
 */
import { registerBuiltins } from '../core/entities';
import type { LevelDef } from '../level/schema';
import { parseLevel } from '../level/validate';
import { topoOrder, type WorldDef } from '../level/worlds';
import worldsJson from './worlds.json';

const files = import.meta.glob<{ default: unknown }>('./*/*.json', { eager: true });

registerBuiltins();

const byId = new Map<string, LevelDef>();
for (const k of Object.keys(files)) {
  const level = parseLevel(files[k].default);
  if (byId.has(level.id)) throw new Error(`Duplicate level id ${level.id}`);
  byId.set(level.id, level);
}

/** Worlds in tree order (every world after its parents). */
export const WORLDS: WorldDef[] = topoOrder(worldsJson as WorldDef[]);

/** All campaign levels, world by world. */
export const LEVELS: LevelDef[] = WORLDS.flatMap((w) =>
  w.levels.map((id) => {
    const l = byId.get(id);
    if (!l) throw new Error(`World ${w.id} lists unknown level ${id}`);
    return l;
  }),
);

/** Level files that no world lists (caught by tests). */
export const UNLISTED: string[] = [...byId.keys()].filter((id) => !LEVELS.some((l) => l.id === id));
