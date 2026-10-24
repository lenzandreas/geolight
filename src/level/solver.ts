/**
 * Brute-force level solver used by tests and level design (and later perhaps
 * hints or a level editor's "is this solvable?" check).
 *
 * Pieces only matter where light already goes, so placements are restricted to
 * cells the current light passes through. That keeps laser levels fast; levels
 * with diffuse sources (light everywhere) should keep their trays small.
 */
import { evaluate } from '../core/rules';
import { footprint, getType } from '../core/registry';
import { trace, type TraceResult } from '../core/tracer';
import type { Entity } from '../core/types';
import { Session, slotKey } from '../game/session';
import type { LevelDef, SolutionStep } from './schema';

export interface SolveOptions {
  maxSolutions?: number;
  /** Abort after this many traces. */
  maxNodes?: number;
  /** Only search solutions using at most this many tray pieces. */
  maxPieces?: number;
}

export interface SolveResult {
  solutions: SolutionStep[][];
  nodes: number;
  exhausted: boolean;
}

function litCells(t: TraceResult, w: number, h: number): Set<number> {
  const cells = new Set<number>();
  for (const s of t.segments) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    const steps = Math.max(1, Math.ceil(len / 0.1));
    for (let i = 0; i <= steps; i++) {
      const x = Math.floor(s.a.x + ((s.b.x - s.a.x) * i) / steps);
      const y = Math.floor(s.a.y + ((s.b.y - s.a.y) * i) / steps);
      if (x >= 0 && y >= 0 && x < w && y < h) cells.add(y * w + x);
    }
  }
  return cells;
}

function anglesFor(type: string, step: number): number[] {
  const sym = getType(type).symmetry ?? 360;
  const out: number[] = [];
  for (let a = 0; a < sym; a += step) out.push(a);
  return out;
}

export function solve(level: LevelDef, opts: SolveOptions = {}): SolveResult {
  const maxSolutions = opts.maxSolutions ?? 1;
  const maxNodes = opts.maxNodes ?? 200000;
  const { w, h } = level.grid;
  const step = level.rotationStep ?? 15;
  const base = new Session(level).pieces as Entity[];
  const rotatable = base.filter((_, i) => level.entities[i].lock === 'rotate' || level.entities[i].lock === 'free');
  const tray: { key: string; type: string; params: Record<string, unknown> }[] = [];
  for (const item of level.inventory) for (let i = 0; i < item.count; i++) tray.push({ key: slotKey(item.type, item.params), type: item.type, params: item.params ?? {} });
  const maxPieces = Math.min(opts.maxPieces ?? tray.length, tray.length);

  const solutions: SolutionStep[][] = [];
  const seen = new Set<string>();
  let nodes = 0;
  const done = () => solutions.length >= maxSolutions || nodes >= maxNodes;

  const occupied = (entities: Entity[]) => {
    const s = new Set<number>();
    for (const e of entities) for (const [x, y] of footprint(e)) s.add(y * w + x);
    return s;
  };

  const record = (entities: Entity[]) => {
    const steps: SolutionStep[] = [];
    for (const r of rotatable) steps.push({ id: r.id, x: r.x, y: r.y, angle: r.angle });
    for (const e of entities.slice(base.length)) steps.push({ type: e.type, params: Object.keys(e.params).length ? e.params : undefined, x: e.x, y: e.y, angle: e.angle });
    const key = steps.map((s) => `${s.id ?? s.type}@${s.x},${s.y},${s.angle}`).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    solutions.push(steps);
  };

  const placeTray = (entities: Entity[], used: boolean[], count: number) => {
    if (done()) return;
    nodes++;
    const t = trace(entities, { width: w, height: h });
    if (evaluate(entities, t, level.goal).won) {
      record(entities);
      return;
    }
    if (count >= maxPieces) return;
    const lit = litCells(t, w, h);
    const occ = occupied(entities);
    const triedKeys = new Set<string>();
    for (let i = 0; i < tray.length; i++) {
      if (used[i] || triedKeys.has(tray[i].key)) continue;
      triedKeys.add(tray[i].key);
      used[i] = true;
      for (const cell of lit) {
        if (occ.has(cell)) continue;
        for (const angle of anglesFor(tray[i].type, step)) {
          entities.push({ id: `s${count}`, type: tray[i].type, x: cell % w, y: Math.floor(cell / w), angle, params: tray[i].params });
          placeTray(entities, used, count + 1);
          entities.pop();
          if (done()) break;
        }
        if (done()) break;
      }
      used[i] = false;
      if (done()) return;
    }
  };

  const rotate = (i: number, entities: Entity[]) => {
    if (done()) return;
    if (i === rotatable.length) {
      placeTray(entities, tray.map(() => false), 0);
      return;
    }
    const r = rotatable[i];
    const original = r.angle;
    for (const a of anglesFor(r.type, step)) {
      r.angle = a;
      rotate(i + 1, entities);
      if (done()) break;
    }
    if (!done()) r.angle = original;
  };

  rotate(0, [...base]);
  return { solutions, nodes, exhausted: nodes < maxNodes && solutions.length < maxSolutions };
}
