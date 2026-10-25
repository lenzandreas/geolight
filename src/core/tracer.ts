import { addInto, black, power, type RGB } from './color';
import { rayCircle, rayShape } from './geometry';
import { addScaled, type Vec } from './math';
import { getType } from './registry';
import { absorb } from './interactions';
import { param, type Entity, type Field, type Hit, type Ray, type Surface, type TraceContext } from './types';

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
  /** Ids of switchable structures (gates) that ended up open. */
  open: Set<string>;
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
/** Inside a gravity field light moves in short straight steps: this share of the distance to the centre. */
const FIELD_STEP = 0.1;
const FIELD_STEP_MIN = 0.02;
const FIELD_STEP_MAX = 0.25;
/** A ray caught in orbit is given up after this many steps. */
const MAX_FIELD_STEPS = 3000;

function boundary(w: number, h: number): Surface[] {
  const p = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  return p.map((a, i) => ({ shape: { kind: 'segment', a, b: p[(i + 1) % 4] }, entity: null, interact: absorb }));
}

export function collectSurfaces(entities: Entity[], width: number, height: number, open: Set<string> = new Set()): Surface[] {
  const out = boundary(width, height);
  for (const e of entities) if (!open.has(e.id)) getType(e.type).surfaces(e, out);
  return out;
}

/**
 * Trace all light in the scene. Pure function of its inputs, so it can run in a
 * worker, in tests, or in a solver.
 *
 * Gates open while their receivers are powered. Opening a gate only ever adds
 * light, so starting with every gate shut and opening the powered ones until
 * nothing changes finds the one consistent state (a gate can't hold itself open
 * with light that only gets through once it is open).
 */
export function trace(entities: Entity[], opts: TraceOptions): TraceResult {
  const switchable = entities.filter((e) => getType(e.type).isOpen);
  const open = new Set<string>();
  for (;;) {
    const result = traceOnce(entities, opts, open);
    result.open = new Set(open);
    if (!switchable.length) return result;
    const powered = (id: string) => {
      const e = entities.find((x) => x.id === id);
      const got = result.received.get(id);
      if (!e || !got) return false;
      return power(got) + 1e-9 >= (param<number>(e, getType(e.type), 'required') ?? 0);
    };
    let changed = false;
    for (const g of switchable) {
      if (!open.has(g.id) && getType(g.type).isOpen!(g, powered)) {
        open.add(g.id);
        changed = true;
      }
    }
    if (!changed) return result;
  }
}

/** Where the next straight piece of a ray ends because of gravity fields, or null if none applies. */
function fieldStep(ray: Ray, fields: Field[]): { t: number; inside: boolean } | null {
  let h = Infinity;
  let enter = Infinity;
  for (const f of fields) {
    const r = Math.hypot(ray.o.x - f.c.x, ray.o.y - f.c.y);
    if (r < f.reach) h = Math.min(h, Math.min(FIELD_STEP_MAX, Math.max(FIELD_STEP_MIN, FIELD_STEP * r)));
    else enter = Math.min(enter, rayCircle(ray.o, ray.d, f.c, f.reach));
  }
  if (h < Infinity) return { t: Math.min(h, enter + 1e-4), inside: true };
  if (enter < Infinity) return { t: enter + 1e-4, inside: false };
  return null;
}

/** Direction after a step of length t: every field pulls towards its centre (judged at the step's midpoint). */
function bend(ray: Ray, t: number, fields: Field[]): Vec {
  const m = addScaled(ray.o, ray.d, t / 2);
  let dx = ray.d.x;
  let dy = ray.d.y;
  for (const f of fields) {
    const rx = m.x - f.c.x;
    const ry = m.y - f.c.y;
    const r = Math.hypot(rx, ry);
    if (r >= f.reach || r < 1e-9) continue;
    // Only the part of the offset across the ray turns it; over a straight pass this sums to 2·rs/b.
    const along = rx * ray.d.x + ry * ray.d.y;
    const k = (f.rs * t) / (r * r * r);
    dx -= k * (rx - along * ray.d.x);
    dy -= k * (ry - along * ray.d.y);
  }
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
}

function traceOnce(entities: Entity[], opts: TraceOptions, open: Set<string>): TraceResult {
  const maxDepth = opts.maxDepth ?? 48;
  const minPower = opts.minPower ?? 1e-5;
  const maxSegments = opts.maxSegments ?? 40000;

  const surfaces = collectSurfaces(entities, opts.width, opts.height, open);
  const fields: Field[] = [];
  for (const e of entities) {
    const f = getType(e.type).field?.(e);
    if (f) fields.push(f);
  }
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
    if (fields.length) {
      // Inside (or about to enter) a gravity field the ray moves in short steps, turning after each.
      const step = fieldStep(ray, fields);
      if (step && step.t < bestT) {
        let t = step.t;
        let swallowed = false;
        for (const f of fields) {
          const tc = rayCircle(ray.o, ray.d, f.c, f.capture);
          const inside = Math.hypot(ray.o.x - f.c.x, ray.o.y - f.c.y) < f.capture;
          if (inside || tc <= t) {
            t = inside ? 0 : Math.min(t, tc);
            swallowed = true;
          }
        }
        const point = addScaled(ray.o, ray.d, t);
        if (t > 0) segments.push({ a: ray.o, b: point, c: ray.c, root: ray.root ?? 0 });
        if (swallowed) continue;
        const steps = (ray.steps ?? 0) + 1;
        if (steps > MAX_FIELD_STEPS) {
          truncated = true;
          continue;
        }
        const d = step.inside ? bend(ray, t, fields) : ray.d;
        stack.push({ ...ray, o: point, d, steps });
        continue;
      }
    }
    const point = addScaled(ray.o, ray.d, bestT);
    segments.push({ a: ray.o, b: point, c: ray.c, root: ray.root ?? 0 });
    const hit: Hit = { point, t: bestT, surface: best };
    lastSurface = best;
    best.interact(ray, hit, ctx);
    lastSurface = null;
  }

  return { segments, received, receptions, emitted, truncated, open };
}
