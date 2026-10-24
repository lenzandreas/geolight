import { cross, dot, sub, type Vec } from './math';

export const EPS = 1e-7;

export type Shape =
  | { kind: 'segment'; a: Vec; b: Vec }
  | { kind: 'circle'; c: Vec; r: number };

/** Distance along a unit ray to a segment, or Infinity. */
export function raySegment(o: Vec, d: Vec, a: Vec, b: Vec): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = d.x * ey - d.y * ex;
  if (Math.abs(denom) < 1e-12) return Infinity;
  const wx = a.x - o.x;
  const wy = a.y - o.y;
  const t = (wx * ey - wy * ex) / denom;
  if (t <= EPS) return Infinity;
  const u = (wx * d.y - wy * d.x) / denom;
  if (u < 0 || u > 1) return Infinity;
  return t;
}

/** Distance along a unit ray to a circle boundary (entry, or exit if starting inside), or Infinity. */
export function rayCircle(o: Vec, d: Vec, c: Vec, r: number): number {
  const mx = o.x - c.x;
  const my = o.y - c.y;
  const b = mx * d.x + my * d.y;
  const cc = mx * mx + my * my - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t1 = -b - s;
  if (t1 > EPS) return t1;
  const t2 = -b + s;
  if (t2 > EPS) return t2;
  return Infinity;
}

export function rayShape(o: Vec, d: Vec, s: Shape): number {
  return s.kind === 'segment' ? raySegment(o, d, s.a, s.b) : rayCircle(o, d, s.c, s.r);
}

/** Distance from point p to segment ab. */
export function pointSegmentDistance(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
}

/** Signed area > 0 means clockwise on screen (y down). */
export function polygonArea(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += cross(pts[i], pts[(i + 1) % pts.length]);
  return s / 2;
}
