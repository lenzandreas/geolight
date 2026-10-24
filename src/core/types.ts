import type { RGB } from './color';
import type { Shape } from './geometry';
import type { Vec } from './math';

/**
 * Everything on the board is an Entity: sources, targets, optics, walls.
 * Behaviour comes from its EntityType (looked up by `type`), so new objects are
 * added by registering a new type without touching the tracer.
 */
export interface Entity {
  /** Unique within a level. */
  id: string;
  type: string;
  /** Grid cell (may be fractional while dragging). The entity's centre is (x + 0.5, y + 0.5). */
  x: number;
  y: number;
  /** Orientation in degrees. */
  angle: number;
  params: Record<string, unknown>;
}

export interface Ray {
  o: Vec;
  /** Unit direction. */
  d: Vec;
  /** Power per channel. */
  c: RGB;
  depth: number;
  /** Source entity id, kept for future scoring or per-source rules. */
  source: string;
  /** Index of the emitted ray this one descends from (set by the tracer). */
  root?: number;
}

export interface Hit {
  point: Vec;
  t: number;
  surface: Surface;
}

export interface TraceContext {
  /** Spawn a new ray (reflected, refracted, split...). Depth is handled by the tracer. */
  emit(parent: Ray, o: Vec, d: Vec, c: RGB): void;
  /** Register light absorbed by a receiver entity. */
  receive(entity: Entity, c: RGB, ray: Ray): void;
}

/** What happens when a ray hits a surface. Absorbing surfaces simply do nothing. */
export type Interaction = (ray: Ray, hit: Hit, ctx: TraceContext) => void;

export interface Surface {
  shape: Shape;
  entity: Entity | null;
  interact: Interaction;
  /** For flat surfaces: a precomputed unit normal (outward, for closed bodies). */
  normal?: Vec;
}

export type EntityCategory = 'source' | 'target' | 'optic' | 'structure';

export interface EntityType {
  id: string;
  category: EntityCategory;
  /** Default parameter values, merged under per-entity params. */
  defaults: Record<string, unknown>;
  /** Angles that produce identical physics (e.g. 180 for a two-sided mirror). Used by solvers and hints. */
  symmetry?: number;
  /** Cells covered relative to the anchor cell. Defaults to just the anchor. */
  footprint?(e: Entity): Array<[number, number]>;
  /** Append this entity's optical surfaces. */
  surfaces(e: Entity, out: Surface[]): void;
  /** Append rays emitted by this entity (sources only). */
  emit?(e: Entity, out: Ray[]): void;
}

/** Read a typed parameter with registry defaults applied. */
export function param<T>(e: Entity, type: EntityType, key: string): T {
  return (key in e.params ? e.params[key] : type.defaults[key]) as T;
}
