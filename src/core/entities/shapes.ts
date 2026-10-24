import { polygonArea } from '../geometry';
import { add, fromAngle, normalize, perp, rotate, scale, sub, type Vec } from '../math';
import type { Entity, Interaction, Surface } from '../types';

export const centre = (e: Entity): Vec => ({ x: e.x + 0.5, y: e.y + 0.5 });

/** Facing direction (normal) of a thin optic. */
export const facing = (e: Entity): Vec => fromAngle(e.angle);

/** Endpoints of a thin element of `len` cells, centred on the entity, perpendicular to its facing. */
export function thinSegment(e: Entity, len: number): { a: Vec; b: Vec; c: Vec; t: Vec; n: Vec } {
  const c = centre(e);
  const n = facing(e);
  const t = perp(n);
  return { a: add(c, scale(t, -len / 2)), b: add(c, scale(t, len / 2)), c, t, n };
}

/** Vertices of a regular polygon around the entity centre, rotated by its angle. */
export function regularPolygon(e: Entity, sides: number, radius: number): Vec[] {
  const c = centre(e);
  const pts: Vec[] = [];
  for (let i = 0; i < sides; i++) pts.push(add(c, rotate({ x: radius, y: 0 }, e.angle + (360 / sides) * i)));
  return pts;
}

/** Rectangle of size w×h around the entity centre, rotated by its angle. */
export function rotatedRect(e: Entity, w: number, h: number): Vec[] {
  const c = centre(e);
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map((p) => add(c, rotate(p, e.angle)));
}

/** Add one surface per polygon edge with outward normals. */
export function pushPolygon(out: Surface[], entity: Entity | null, pts: Vec[], interact: Interaction): void {
  const cw = polygonArea(pts) > 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const p = normalize(perp(sub(b, a)));
    // perp rotates +90°; for a clockwise (screen) polygon that points inward.
    const normal = cw ? { x: -p.x, y: -p.y } : p;
    out.push({ shape: { kind: 'segment', a, b }, entity, interact, normal });
  }
}
