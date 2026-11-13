/**
 * Where worlds sit on the star map. Worlds carry hand-placed map coordinates
 * (`map` in worlds.json), so the map reads as a sky to wander across rather than
 * a tree diagram; a world without them is placed below its parents.
 */
import { depths, type WorldDef } from '../level/worlds';

export interface MapPoint {
  x: number;
  y: number;
}

/** Two worlds this far apart (map units) in x or in y are drawn without touching. */
export const MAP_CLEARANCE = 0.95;

/** Map coordinates for every world: its own, or a spot one row below its lowest parent. */
export function mapPositions(worlds: WorldDef[]): Map<string, MapPoint> {
  const pos = new Map<string, MapPoint>();
  const depth = depths(worlds);
  const order = [...worlds].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!);
  for (const w of order) {
    if (w.map) {
      pos.set(w.id, { x: w.map[0], y: w.map[1] });
      continue;
    }
    const parents = w.parents.map((p) => pos.get(p)!);
    let x = parents.length ? parents.reduce((s, p) => s + p.x, 0) / parents.length : 0;
    const y = parents.length ? Math.max(...parents.map((p) => p.y)) + 1.2 : 0;
    // Step sideways until the spot is free.
    const taken = (px: number) => [...pos.values()].some((q) => Math.abs(q.x - px) < 1 && Math.abs(q.y - y) < 1);
    for (let i = 1; taken(x); i++) x += (i % 2 ? i : -i) * 1;
    pos.set(w.id, { x, y });
  }
  return pos;
}

export interface MapLayout {
  /** Top centre of each world's box, in pixels. */
  at: Map<string, MapPoint>;
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
  compact: boolean;
}

/** Fit the map into `avail` pixels of width; it grows downwards and scrolls. */
export function layoutMap(worlds: WorldDef[], avail: number): MapLayout {
  const pos = mapPositions(worlds);
  const pts = [...pos.values()];
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const spanX = Math.max(...pts.map((p) => p.x)) - minX;
  const spanY = Math.max(...pts.map((p) => p.y)) - minY;
  // Boxes take 0.9 of a clearance step, so neighbours keep a gap.
  const fit = MAP_CLEARANCE * 0.9;
  const nodeW = Math.max(60, Math.min(128, (fit * avail) / (spanX + fit)));
  const unitX = spanX > 0 ? Math.max(nodeW / fit, (avail - nodeW) / spanX) : 0;
  const compact = nodeW < 104;
  const nodeH = compact ? 96 : 118;
  const unitY = (nodeH + (compact ? 14 : 20)) / MAP_CLEARANCE;
  const at = new Map<string, MapPoint>();
  for (const [id, p] of pos) at.set(id, { x: nodeW / 2 + (p.x - minX) * unitX, y: (p.y - minY) * unitY });
  return { at, width: nodeW + spanX * unitX, height: nodeH + spanY * unitY, nodeW, nodeH, compact };
}
