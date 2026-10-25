/**
 * Worlds group levels around one newly introduced piece and form a tree
 * (a constellation map): a world opens once its parent worlds are mostly solved.
 */
import type { LevelDef, Localized } from './schema';

/** Placeable piece kinds, as the player sees them (a diverging lens counts as its own piece). */
export type PieceKind = 'mirror' | 'splitter' | 'lens' | 'divergingLens' | 'curvedMirror' | 'filter' | 'prism' | 'block' | 'blocker' | 'polarizer' | 'blackHole' | 'grating';

export interface WorldDef {
  id: string;
  name: Localized;
  /** The one new piece this world introduces. */
  object: PieceKind;
  parents: string[];
  /** Level ids in play order. */
  levels: string[];
}

const PIECES = new Set<string>(['mirror', 'splitter', 'lens', 'curvedMirror', 'filter', 'prism', 'block', 'blocker', 'polarizer', 'blackHole', 'grating']);

/** Piece kind of an entity type, or null for sources, targets and structures. */
export function pieceKind(type: string, params: Record<string, unknown> = {}): PieceKind | null {
  if (!PIECES.has(type)) return null;
  if (type === 'lens' && typeof params.f === 'number' && params.f < 0) return 'divergingLens';
  return type as PieceKind;
}

/** Every piece kind a level uses, in the tray or pre-placed. */
export function piecesUsed(level: LevelDef): Set<PieceKind> {
  const out = new Set<PieceKind>();
  for (const e of [...level.entities, ...level.inventory]) {
    const k = pieceKind(e.type, e.params);
    if (k) out.add(k);
  }
  return out;
}

/** Worlds from the root down, each after all of its parents. */
export function topoOrder(worlds: WorldDef[]): WorldDef[] {
  const out: WorldDef[] = [];
  const done = new Set<string>();
  while (out.length < worlds.length) {
    const next = worlds.find((w) => !done.has(w.id) && w.parents.every((p) => done.has(p)));
    if (!next) throw new Error('World graph has a cycle or an unknown parent');
    out.push(next);
    done.add(next.id);
  }
  return out;
}

/** Depth of each world in the tree (root = 0), for map layout. */
export function depths(worlds: WorldDef[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const w of topoOrder(worlds)) d.set(w.id, w.parents.length ? Math.max(...w.parents.map((p) => d.get(p)!)) + 1 : 0);
  return d;
}

/** All worlds a world builds on (its ancestors), excluding itself. */
export function ancestors(worlds: WorldDef[], id: string): Set<string> {
  const byId = new Map(worlds.map((w) => [w.id, w]));
  const out = new Set<string>();
  const stack = [...(byId.get(id)?.parents ?? [])];
  while (stack.length) {
    const p = stack.pop()!;
    if (out.has(p)) continue;
    out.add(p);
    stack.push(...(byId.get(p)?.parents ?? []));
  }
  return out;
}
