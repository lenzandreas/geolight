/**
 * Built-in entity types. Each type is pure data + physics; visuals live in
 * src/render/drawers.ts so the core stays headless and testable.
 *
 * Angle convention: for every type `angle` is the facing direction —
 * the beam direction for emitters, the surface normal for thin optics.
 */
import { resolveColor, spectrum, type RGB } from '../color';
import { absorb, filter, mirror, receiver, refract, splitter, thinOptic } from '../interactions';
import { add, fromAngle, perp, scale } from '../math';
import { registerType } from '../registry';
import { param, type Entity, type EntityType } from '../types';
import { centre, pushPolygon, regularPolygon, rotatedRect, thinSegment } from './shapes';

export const THIN_LEN = 0.9;
export const SINK_RADIUS = 0.32;
export const SENSOR_RADIUS = 0.28;

/* ---------- Sources ---------- */

export const Laser: EntityType = {
  id: 'laser',
  category: 'source',
  defaults: { color: 'white', power: 1 },
  surfaces(e, out) {
    pushPolygon(out, e, rotatedRect(e, 0.62, 0.42), absorb);
  },
  emit(e, out) {
    const d = fromAngle(e.angle);
    const c = spectrum(resolveColor(param(e, Laser, 'color')), param<number>(e, Laser, 'power'));
    out.push({ o: add(centre(e), scale(d, 0.33)), d, c, depth: 0, source: e.id });
  },
};

export const Bulb: EntityType = {
  id: 'bulb',
  category: 'source',
  defaults: { color: 'white', power: 1, rays: 720 },
  symmetry: 360,
  surfaces(e, out) {
    out.push({ shape: { kind: 'circle', c: centre(e), r: 0.2 }, entity: e, interact: absorb });
  },
  emit(e, out) {
    const n = param<number>(e, Bulb, 'rays');
    const c = spectrum(resolveColor(param(e, Bulb, 'color')), param<number>(e, Bulb, 'power') / n);
    const o = centre(e);
    // Half-step offset so no ray starts exactly axis-aligned (avoids grazing hits on grid-aligned walls).
    for (let i = 0; i < n; i++) {
      const d = fromAngle(e.angle + (360 / n) * (i + 0.5));
      out.push({ o: add(o, scale(d, 0.21)), d, c: [...c] as RGB, depth: 0, source: e.id });
    }
  },
};

/** A window of sunlight: a wide band of parallel rays. */
export const Sun: EntityType = {
  id: 'sun',
  category: 'source',
  defaults: { color: 'white', power: 1, width: 3, rays: 90 },
  surfaces(e, out) {
    const w = param<number>(e, Sun, 'width');
    const d = fromAngle(e.angle);
    const t = perp(d);
    const back = add(centre(e), scale(d, -0.1));
    out.push({ shape: { kind: 'segment', a: add(back, scale(t, -w / 2)), b: add(back, scale(t, w / 2)) }, entity: e, interact: absorb });
  },
  emit(e, out) {
    const w = param<number>(e, Sun, 'width');
    const n = param<number>(e, Sun, 'rays');
    const d = fromAngle(e.angle);
    const t = perp(d);
    const c = spectrum(resolveColor(param(e, Sun, 'color')), param<number>(e, Sun, 'power') / n);
    const o = centre(e);
    for (let i = 0; i < n; i++) {
      const off = -w / 2 + (w * (i + 0.5)) / n;
      out.push({ o: add(o, scale(t, off)), d, c: [...c] as RGB, depth: 0, source: e.id });
    }
  },
};

/* ---------- Targets ---------- */

export const Sink: EntityType = {
  id: 'sink',
  category: 'target',
  /** required: power needed (1 = one full laser). color: accepted channels. strict: off-colour light spoils it. */
  defaults: { required: 0.9, color: 'white', strict: false, radius: SINK_RADIUS },
  symmetry: 360,
  surfaces(e, out) {
    out.push({ shape: { kind: 'circle', c: centre(e), r: param<number>(e, Sink, 'radius') }, entity: e, interact: receiver(e) });
  },
};

/** Must stay dark: lighting it above `limit` fails the level. */
export const Sensor: EntityType = {
  id: 'sensor',
  category: 'target',
  defaults: { limit: 0.02 },
  symmetry: 360,
  surfaces(e, out) {
    out.push({ shape: { kind: 'circle', c: centre(e), r: SENSOR_RADIUS }, entity: e, interact: receiver(e) });
  },
};

/* ---------- Optics ---------- */

function thin(e: Entity, interact: ReturnType<typeof mirror>, out: Parameters<EntityType['surfaces']>[1]): void {
  const s = thinSegment(e, THIN_LEN);
  out.push({ shape: { kind: 'segment', a: s.a, b: s.b }, entity: e, interact, normal: s.n });
}

export const Mirror: EntityType = {
  id: 'mirror',
  category: 'optic',
  defaults: { reflectance: 1 },
  symmetry: 180,
  surfaces(e, out) {
    thin(e, mirror(param<number>(e, Mirror, 'reflectance')), out);
  },
};

export const Splitter: EntityType = {
  id: 'splitter',
  category: 'optic',
  defaults: { ratio: 0.5 },
  symmetry: 180,
  surfaces(e, out) {
    thin(e, splitter(param<number>(e, Splitter, 'ratio')), out);
  },
};

export const Filter: EntityType = {
  id: 'filter',
  category: 'optic',
  defaults: { color: 'red' },
  symmetry: 180,
  surfaces(e, out) {
    thin(e, filter(resolveColor(param(e, Filter, 'color'))), out);
  },
};

/** Ideal thin lens. f > 0 converges, f < 0 diverges. Focal length in cells. */
export const Lens: EntityType = {
  id: 'lens',
  category: 'optic',
  defaults: { f: 2 },
  symmetry: 180,
  surfaces(e, out) {
    const s = thinSegment(e, THIN_LEN);
    out.push({ shape: { kind: 'segment', a: s.a, b: s.b }, entity: e, interact: thinOptic(s.c, s.t, s.n, param<number>(e, Lens, 'f'), false, false), normal: s.n });
  },
};

/** Ideal concave mirror (f > 0) with an absorbing back. */
export const CurvedMirror: EntityType = {
  id: 'curvedMirror',
  category: 'optic',
  defaults: { f: 1.5 },
  surfaces(e, out) {
    const s = thinSegment(e, THIN_LEN);
    out.push({ shape: { kind: 'segment', a: s.a, b: s.b }, entity: e, interact: thinOptic(s.c, s.t, s.n, param<number>(e, CurvedMirror, 'f'), true, true), normal: s.n });
  },
};

/** Triangular prism; per-channel refractive index gives dispersion. */
export const Prism: EntityType = {
  id: 'prism',
  category: 'optic',
  defaults: { n: [1.38, 1.5, 1.64], radius: 0.46 },
  symmetry: 120,
  surfaces(e, out) {
    const n = param<RGB>(e, Prism, 'n');
    pushPolygon(out, e, regularPolygon(e, 3, param<number>(e, Prism, 'radius')), refract(n));
  },
};

/** Square glass block, no dispersion: shifts and bends beams. */
export const GlassBlock: EntityType = {
  id: 'block',
  category: 'optic',
  defaults: { n: 1.5, size: 0.8 },
  symmetry: 90,
  surfaces(e, out) {
    const n = param<number>(e, GlassBlock, 'n');
    const s = param<number>(e, GlassBlock, 'size');
    pushPolygon(out, e, rotatedRect(e, s, s), refract([n, n, n]));
  },
};

/** A small absorbing block the player can place to shade things. */
export const Blocker: EntityType = {
  id: 'blocker',
  category: 'optic',
  defaults: { size: 0.56 },
  symmetry: 90,
  surfaces(e, out) {
    const s = param<number>(e, Blocker, 'size');
    pushPolygon(out, e, rotatedRect(e, s, s), absorb);
  },
};

/* ---------- Structure ---------- */

/** Axis-aligned absorbing wall covering w×h cells from its anchor cell. */
export const Wall: EntityType = {
  id: 'wall',
  category: 'structure',
  defaults: { w: 1, h: 1 },
  symmetry: 360,
  footprint(e) {
    const w = param<number>(e, Wall, 'w');
    const h = param<number>(e, Wall, 'h');
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) cells.push([e.x + i, e.y + j]);
    return cells;
  },
  surfaces(e, out) {
    const w = param<number>(e, Wall, 'w');
    const h = param<number>(e, Wall, 'h');
    pushPolygon(out, e, [
      { x: e.x, y: e.y },
      { x: e.x + w, y: e.y },
      { x: e.x + w, y: e.y + h },
      { x: e.x, y: e.y + h },
    ], absorb);
  },
};

export const BUILTIN_TYPES: EntityType[] = [Laser, Bulb, Sun, Sink, Sensor, Mirror, Splitter, Filter, Lens, CurvedMirror, Prism, GlassBlock, Blocker, Wall];

let registered = false;
/** Idempotent registration of the built-in types. */
export function registerBuiltins(): void {
  if (registered) return;
  registered = true;
  for (const t of BUILTIN_TYPES) registerType(t);
}
