/**
 * Built-in entity types. Each type is pure data + physics; visuals live in
 * src/render/drawers.ts so the core stays headless and testable.
 *
 * Angle convention: for every type `angle` is the facing direction —
 * the beam direction for emitters, the surface normal for thin optics.
 */
import { resolveColor, spectrum, type RGB } from '../color';
import { absorb, filter, mirror, polarize, receiver, refract, splitter, thinOptic } from '../interactions';
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
  /** pol: polarization axis in degrees, or null for unpolarized light. */
  defaults: { color: 'white', power: 1, pol: null },
  surfaces(e, out) {
    pushPolygon(out, e, rotatedRect(e, 0.62, 0.42), absorb);
  },
  emit(e, out) {
    const d = fromAngle(e.angle);
    const c = spectrum(resolveColor(param(e, Laser, 'color')), param<number>(e, Laser, 'power'));
    out.push({ o: add(centre(e), scale(d, 0.33)), d, c, depth: 0, source: e.id, pol: param<number | null>(e, Laser, 'pol') });
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
  /**
   * each: every channel in `color` must deliver its share (colour mixing, e.g. yellow = red + green).
   * pol: if set, only light polarized along this axis counts (and with `strict`, other light spoils it).
   */
  defaults: { required: 0.9, color: 'white', strict: false, each: false, radius: SINK_RADIUS, pol: null },
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

export const POLARIZER_RADIUS = 0.34;

/** Polarizing disc. Its axis is the entity angle (mod 180); light crosses it from any side. */
export const Polarizer: EntityType = {
  id: 'polarizer',
  category: 'optic',
  defaults: {},
  symmetry: 180,
  surfaces(e, out) {
    const c = centre(e);
    out.push({ shape: { kind: 'circle', c, r: POLARIZER_RADIUS }, entity: e, interact: polarize(c, ((e.angle % 180) + 180) % 180) });
  },
};

/** Light closer than this many Schwarzschild radii is captured (the black hole's shadow, 3√3/2). */
export const SHADOW_FACTOR = (3 * Math.sqrt(3)) / 2;

/**
 * A black hole: no surfaces, only gravity. Passing light bends towards it (more the
 * closer it passes) and light that comes within its shadow is swallowed.
 * rs: Schwarzschild radius in cells. reach: how far its pull is counted.
 */
export const BlackHole: EntityType = {
  id: 'blackHole',
  category: 'optic',
  defaults: { rs: 0.2, reach: 2 },
  symmetry: 360,
  surfaces() {},
  field(e) {
    const rs = param<number>(e, BlackHole, 'rs');
    return { c: centre(e), rs, reach: param<number>(e, BlackHole, 'reach'), capture: SHADOW_FACTOR * rs };
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

export const SLIT_THICKNESS = 0.18;

/**
 * A one-cell barrier with a narrow opening. It faces `angle` (light passes along it);
 * `gap` is the opening width and `offset` shifts it sideways (in cells).
 */
export const Slit: EntityType = {
  id: 'slit',
  category: 'structure',
  defaults: { gap: 0.2, offset: 0 },
  surfaces(e, out) {
    const gap = param<number>(e, Slit, 'gap');
    const offset = param<number>(e, Slit, 'offset');
    const c = centre(e);
    const n = fromAngle(e.angle);
    const t = perp(n);
    const bar = (from: number, to: number) => {
      if (to - from < 1e-6) return;
      const mid = (from + to) / 2;
      const len = to - from;
      const p = add(c, scale(t, mid));
      pushPolygon(out, e, rotatedRect({ ...e, x: p.x - 0.5, y: p.y - 0.5 }, SLIT_THICKNESS, len), absorb);
    };
    bar(-0.5, offset - gap / 2);
    bar(offset + gap / 2, 0.5);
  },
};

function blockCells(e: Entity, w: number, h: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) cells.push([e.x + i, e.y + j]);
  return cells;
}

function blockSurfaces(e: Entity, w: number, h: number, out: Parameters<EntityType['surfaces']>[1]): void {
  pushPolygon(out, e, [
    { x: e.x, y: e.y },
    { x: e.x + w, y: e.y },
    { x: e.x + w, y: e.y + h },
    { x: e.x, y: e.y + h },
  ], absorb);
}

/** Axis-aligned absorbing wall covering w×h cells from its anchor cell. */
export const Wall: EntityType = {
  id: 'wall',
  category: 'structure',
  defaults: { w: 1, h: 1 },
  symmetry: 360,
  footprint(e) {
    return blockCells(e, param(e, Wall, 'w'), param(e, Wall, 'h'));
  },
  surfaces(e, out) {
    blockSurfaces(e, param(e, Wall, 'w'), param(e, Wall, 'h'), out);
  },
};

export const PHOTOCELL_SIZE = 0.5;

/** A small solar panel. It is powered once it receives `required`; gates listen to it. */
export const Photocell: EntityType = {
  id: 'photocell',
  category: 'structure',
  defaults: { required: 0.1 },
  symmetry: 360,
  surfaces(e, out) {
    pushPolygon(out, e, rotatedRect(e, PHOTOCELL_SIZE, PHOTOCELL_SIZE), receiver(e));
  },
};

/** The ids a gate listens to. */
export function gateInputs(e: Entity): string[] {
  const by = param<string | string[]>(e, Gate, 'by');
  return Array.isArray(by) ? by : by ? [by] : [];
}

/** A wall section (w×h cells) that opens while every receiver in `by` is powered. */
export const Gate: EntityType = {
  id: 'gate',
  category: 'structure',
  defaults: { w: 1, h: 1, by: [] },
  symmetry: 360,
  footprint(e) {
    return blockCells(e, param(e, Gate, 'w'), param(e, Gate, 'h'));
  },
  surfaces(e, out) {
    blockSurfaces(e, param(e, Gate, 'w'), param(e, Gate, 'h'), out);
  },
  isOpen(e, powered) {
    const ids = gateInputs(e);
    return ids.length > 0 && ids.every(powered);
  },
};

export const BUILTIN_TYPES: EntityType[] = [Laser, Bulb, Sun, Sink, Sensor, Mirror, Splitter, Filter, Lens, CurvedMirror, Prism, GlassBlock, Blocker, Wall, Slit, Polarizer, BlackHole, Photocell, Gate];

let registered = false;
/** Idempotent registration of the built-in types. */
export function registerBuiltins(): void {
  if (registered) return;
  registered = true;
  for (const t of BUILTIN_TYPES) registerType(t);
}
