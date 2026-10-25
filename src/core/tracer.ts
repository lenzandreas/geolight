import { addInto, black, power, type RGB } from './color';
import { rayShape } from './geometry';
import { addScaled, type Vec } from './math';
import { getType } from './registry';
import { absorb } from './interactions';
import type { Entity, Hit, Ray, Surface, TraceContext } from './types';

export interface BeamSegment {
  a: Vec;
  b: Vec;
  c: RGB;
  /** Index of the emitted ray this segment descends from (lets renderers group whole light paths). */
  root: number;
}

/** One packet of light absorbed by a receiver. */
export interface Reception {
  c: RGB;
  /** Polarization axis in degrees, or null for unpolarized light. */
  pol: number | null;
}

export interface TraceResult {
  segments: BeamSegment[];
  /** Light received per receiver entity id. */
  received: Map<string, RGB>;
  /** The individual packets behind `received`, for rules that care about polarization. */
  receptions: Map<string, Reception[]>;
  /** Total power emitted by all sources. */
  emitted: number;
  /** True if limits cut the trace short (useful for debugging levels). */
  truncated: boolean;
}

export interface TraceOptions {
  /** Board size in cells; the border absorbs light. */
  width: number;
  height: number;
  maxDepth?: number;
  /** Rays below this power are dropped. */
  minPower?: number;
  maxSegments?: number;
}

const NUDGE = 1e-5;

function boundary(w: number, h: number): Surface[] {
  const p = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  return p.map((a, i) => ({ shape: { kind: 'segment', a, b: p[(i + 1) % 4] }, entity: null, interact: absorb }));
}

export function collectSurfaces(entities: Entity[], width: number, height: number): Surface[] {
  const out = boundary(width, height);
  for (const e of entities) getType(e.type).surfaces(e, out);
  return out;
}

/**
 * Trace all light in the scene. Pure function of its inputs, so it can run in a
 * worker, in tests, or in a solver.
 */
export function trace(entities: Entity[], opts: TraceOptions): TraceResult {
  const maxDepth = opts.maxDepth ?? 48;
  const minPower = opts.minPower ?? 1e-5;
  const maxSegments = opts.maxSegments ?? 40000;

  const surfaces = collectSurfaces(entities, opts.width, opts.height);
  const segments: BeamSegment[] = [];
  const received = new Map<string, RGB>();
  const receptions = new Map<string, Reception[]>();
  const stack: Ray[] = [];
  let emitted = 0;
  let truncated = false;

  for (const e of entities) {
    const t = getType(e.type);
    if (!t.emit) continue;
    const before = stack.length;
    t.emit(e, stack);
    for (let i = before; i < stack.length; i++) emitted += power(stack[i].c);
  }
  stack.forEach((r, i) => (r.root = i));

  // The surface a child ray left from; flat surfaces can never be hit again at t≈0.
  let lastSurface: Surface | null = null;
  const parentSurface = new Map<Ray, Surface>();

  const ctx: TraceContext = {
    emit(parent, o, d, c, pol) {
      if (parent.depth + 1 > maxDepth) {
        truncated = true;
        return;
      }
      if (power(c) < minPower) return;
      const ray: Ray = {
        o: addScaled(o, d, NUDGE),
        d,
        c,
        depth: parent.depth + 1,
        source: parent.source,
        root: parent.root,
        pol: pol === undefined ? parent.pol ?? null : pol,
      };
      if (lastSurface && lastSurface.shape.kind === 'segment') parentSurface.set(ray, lastSurface);
      stack.push(ray);
    },
    receive(entity, c, ray) {
      let acc = received.get(entity.id);
      if (!acc) {
        acc = black();
        received.set(entity.id, acc);
        receptions.set(entity.id, []);
      }
      addInto(acc, c);
      receptions.get(entity.id)!.push({ c: [...c] as RGB, pol: ray.pol ?? null });
    },
  };

  while (stack.length) {
    const ray = stack.pop()!;
    if (segments.length >= maxSegments) {
      truncated = true;
      break;
    }
    const skip = parentSurface.get(ray);
    let bestT = Infinity;
    let best: Surface | null = null;
    for (let i = 0; i < surfaces.length; i++) {
      const s = surfaces[i];
      if (s === skip) continue;
      const t = rayShape(ray.o, ray.d, s.shape);
      if (t < bestT) {
        bestT = t;
        best = s;
      }
    }
    if (!best) continue; // Cannot happen with a closed boundary, but stay safe.
    const point = addScaled(ray.o, ray.d, bestT);
    segments.push({ a: ray.o, b: point, c: ray.c, root: ray.root ?? 0 });
    const hit: Hit = { point, t: bestT, surface: best };
    lastSurface = best;
    best.interact(ray, hit, ctx);
    lastSurface = null;
  }

  return { segments, received, receptions, emitted, truncated };
}
