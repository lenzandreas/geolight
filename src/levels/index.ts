/**
 * Built-in level pack. Files are ordered by their numeric prefix; adding a level
 * means dropping a new JSON file here. Further packs (user levels, daily puzzles)
 * can provide LevelDef arrays from other sources.
 */
import { registerBuiltins } from '../core/entities';
import type { LevelDef } from '../level/schema';
import { parseLevel } from '../level/validate';

const files = import.meta.glob<{ default: unknown }>('./*.json', { eager: true });

registerBuiltins();

export const LEVELS: LevelDef[] = Object.keys(files)
  .sort()
  .map((k) => parseLevel(files[k].default));

export function levelIndex(id: string): number {
  return LEVELS.findIndex((l) => l.id === id);
}
