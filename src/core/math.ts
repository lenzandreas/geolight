/** Minimal 2D vector math. World space: x → right, y → down, angles in degrees, 0° = +x, 90° = +y. */

export interface Vec {
  x: number;
  y: number;
}

export const DEG = Math.PI / 180;

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const addScaled = (a: Vec, b: Vec, s: number): Vec => ({ x: a.x + b.x * s, y: a.y + b.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
/** Perpendicular, rotated +90° (clockwise on screen because y points down). */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });

export function normalize(a: Vec): Vec {
  const l = Math.hypot(a.x, a.y);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

export function fromAngle(deg: number): Vec {
  const r = deg * DEG;
  return { x: Math.cos(r), y: Math.sin(r) };
}

export function rotate(a: Vec, deg: number): Vec {
  const r = deg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Reflect direction d about a unit normal n. */
export function reflect(d: Vec, n: Vec): Vec {
  const k = 2 * dot(d, n);
  return { x: d.x - k * n.x, y: d.y - k * n.y };
}

/** Normalise an angle to [0, 360). */
export function wrapAngle(deg: number): number {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}

/** Shortest signed difference b − a in degrees, in (−180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = wrapAngle(b - a);
  if (d > 180) d -= 360;
  return d;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
