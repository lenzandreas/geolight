/**
 * Level file format (JSON). Versioned via `schema` so old files can be migrated
 * when the format grows (editor, user levels, new modes).
 */
import type { GoalDef } from '../core/rules';

export const LEVEL_SCHEMA = 1;

/** Text in several languages; `en` is the fallback. */
export type Localized = { en: string } & Record<string, string>;

/**
 * fixed: cannot be touched. rotate: fixed position, can be rotated.
 * free: pre-placed but can be moved and rotated (not returned to the tray).
 */
export type LockMode = 'fixed' | 'rotate' | 'free';

export interface EntityDef {
  id?: string;
  type: string;
  x: number;
  y: number;
  angle?: number;
  params?: Record<string, unknown>;
  lock?: LockMode;
}

export interface InventoryItem {
  type: string;
  count: number;
  params?: Record<string, unknown>;
}

/** One step of the reference solution: place a tray item, or turn/move a pre-placed piece by id. */
export interface SolutionStep {
  type?: string;
  params?: Record<string, unknown>;
  id?: string;
  x: number;
  y: number;
  angle: number;
}

export interface LevelDef {
  schema: number;
  id: string;
  /** Unused since worlds are defined in src/levels/worlds.json; kept optional for old files. */
  world?: number;
  name: Localized;
  /** Shown when the level starts. */
  intro?: Localized;
  grid: { w: number; h: number };
  /** Rotation snap in degrees (default 15). */
  rotationStep?: number;
  entities: EntityDef[];
  inventory: InventoryItem[];
  goal?: GoalDef;
  /** Pieces needed for a perfect score; defaults to the solution length. */
  par?: number;
  solution?: SolutionStep[];
}
