/**
 * Turning traced light into game outcomes. Goals are pluggable: register a new
 * goal type to add modes (e.g. "light at least N of M targets", timed goals).
 */
import { dotRGB, power, resolveColor, type RGB } from './color';
import { getType } from './registry';
import type { Reception, TraceResult } from './tracer';
import { param, type Entity } from './types';

export interface TargetStatus {
  id: string;
  /** Photocells only report progress; they never block a win (ok is always true). */
  kind: 'sink' | 'sensor' | 'photocell';
  received: RGB;
  /** Useful light (sink) or total light (sensor). */
  value: number;
  /** Requirement (sink) or limit (sensor). */
  threshold: number;
  /** 0..1 progress towards the requirement (sinks), or alarm level (sensors). */
  progress: number;
  /** Sink: requirement met. Sensor: stayed dark. */
  ok: boolean;
  /** Strict sink receiving light of the wrong colour. */
  contaminated: boolean;
}

export interface Evaluation {
  won: boolean;
  targets: TargetStatus[];
}

export interface GoalDef {
  type: string;
  [key: string]: unknown;
}

export type GoalRule = (targets: TargetStatus[], goal: GoalDef) => boolean;

const goals = new Map<string, GoalRule>();
export function registerGoal(type: string, rule: GoalRule): void {
  goals.set(type, rule);
}

registerGoal('allTargets', (targets) => targets.length > 0 && targets.every((t) => t.ok));
/** Light at least `count` sinks while no sensor triggers. */
registerGoal('anyTargets', (targets, goal) => {
  if (targets.some((t) => t.kind === 'sensor' && !t.ok)) return false;
  return targets.filter((t) => t.kind === 'sink' && t.ok).length >= ((goal.count as number) ?? 1);
});

const TOLERANCE = 1e-6;
const CONTAMINATION_LIMIT = 0.02;

/** Same polarization axis (mod 180°)? */
const sameAxis = (a: number, b: number) => Math.abs(((a - b) % 180 + 270) % 180 - 90) < 0.5;

export function targetStatus(e: Entity, received: RGB | undefined, receptions: Reception[] = []): TargetStatus | null {
  let r: RGB = received ? [...received] as RGB : [0, 0, 0];
  if (e.type === 'sink') {
    const t = getType('sink');
    const mask = resolveColor(param(e, t, 'color'));
    const required = param<number>(e, t, 'required');
    const wantPol = param<number | null>(e, t, 'pol');
    let offPol = 0;
    if (wantPol !== null && wantPol !== undefined) {
      // Only light polarized along the sink's axis counts; the rest is "off" light.
      const aligned: RGB = [0, 0, 0];
      for (const p of receptions) if (p.pol !== null && sameAxis(p.pol, wantPol)) for (let i = 0; i < 3; i++) aligned[i] += p.c[i];
      offPol = power(r) - power(aligned);
      r = aligned;
    }
    const value = dotRGB(r, mask);
    const off = power(r) - value + offPol;
    const contaminated = param<boolean>(e, t, 'strict') && off > CONTAMINATION_LIMIT;
    let progress = required > 0 ? Math.min(1, value / required) : 1;
    let met = value + TOLERANCE >= required;
    if (param<boolean>(e, t, 'each')) {
      // Mixing: each colour in the mask must bring its equal share of the requirement.
      const channels = [0, 1, 2].filter((ch) => mask[ch] > 0);
      const share = required / Math.max(1, channels.length);
      progress = Math.min(1, ...channels.map((ch) => (share > 0 ? (r[ch] * mask[ch]) / share : 1)));
      met = channels.every((ch) => r[ch] * mask[ch] + TOLERANCE >= share);
    }
    return { id: e.id, kind: 'sink', received: r, value, threshold: required, progress, ok: met && !contaminated, contaminated };
  }
  if (e.type === 'photocell') {
    const required = param<number>(e, getType('photocell'), 'required');
    const value = power(r);
    return { id: e.id, kind: 'photocell', received: r, value, threshold: required, progress: required > 0 ? Math.min(1, value / required) : 1, ok: true, contaminated: false };
  }
  if (e.type === 'sensor') {
    const limit = param<number>(e, getType('sensor'), 'limit');
    const value = power(r);
    return { id: e.id, kind: 'sensor', received: r, value, threshold: limit, progress: Math.min(1, value / Math.max(limit, 1e-9)), ok: value <= limit, contaminated: false };
  }
  return null;
}

export function evaluate(entities: Entity[], result: TraceResult, goal: GoalDef = { type: 'allTargets' }): Evaluation {
  const targets: TargetStatus[] = [];
  for (const e of entities) {
    const s = targetStatus(e, result.received.get(e.id), result.receptions.get(e.id));
    if (s) targets.push(s);
  }
  const rule = goals.get(goal.type) ?? goals.get('allTargets')!;
  return { won: rule(targets, goal), targets };
}
