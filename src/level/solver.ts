/**
 * Level solver used by tests, the level report and the level-design tools.
 *
 * It searches placements exhaustively, but only where they can matter:
 *
 * - A tray piece is only tried where the light it would meet already is, and the
 *   branch is dropped unless the light really touches the piece once it is there.
 *   Every solution can be built in an order in which each new piece is touched
 *   (the piece the light reaches first goes first), so nothing is lost.
 * - A piece that can only be turned is left alone until light reaches its cell.
 *   Until then its angle makes no difference, so the angles of unreached pieces
 *   are never multiplied into the search.
 * - Each set of placements is visited once. After a placement has been explored,
 *   it is banned for the later branches of the same node (and everything below
 *   them): any solution containing it was already found.
 *
 * Pre-placed `free` pieces may stay where they are (and are then treated like
 * `rotate` pieces) or be picked up and used like tray pieces that don't count
 * towards par.
 */
import { evaluate, type Evaluation } from '../core/rules';
import { footprint, getType } from '../core/registry';
import { trace, type TraceResult } from '../core/tracer';
import type { Entity } from '../core/types';
import { Session, slotKey } from '../game/session';
import type { LevelDef, SolutionStep } from './schema';

export interface SolveOptions {
  maxSolutions?: number;
  /** Abort after this many traces. */
  maxNodes?: number;
  /** Abort after this many milliseconds. */
  maxMs?: number;
  /** Only search solutions using at most this many tray pieces. */
  maxPieces?: number;
  /** Also report solutions that contain a tray piece they don't need (default: skip them). */
  allowSpare?: boolean;
  /**
   * Shortcut hunt: an approximate search that reaches deeper. Of the placements of one
   * piece that leave the same light on the board (a filter at another angle, a polarizer
   * one cell further along the beam) only the first is followed, and the most promising
   * placements are tried first. Every solution it returns is real, but it can miss some,
   * so "none found" is evidence and not proof.
   */
  hunt?: boolean;
}

export interface SolveResult {
  solutions: SolutionStep[][];
  nodes: number;
  /** The whole search space was covered (in a hunt: the whole reduced space). */
  exhausted: boolean;
  /** Dead ends that look almost solved: every ring at least three quarters full, yet no win. */
  nearMisses: number;
}

/** How close a state is to a win: mean ring progress, minus one for every tripped sensor or spoiled ring. */
export function progressOf(ev: Evaluation): number {
  let sum = 0;
  let n = 0;
  let bad = 0;
  for (const t of ev.targets) {
    if (t.kind === 'sink') {
      sum += t.progress;
      n++;
      if (t.contaminated) bad++;
    } else if (t.kind === 'sensor' && !t.ok) bad++;
  }
  return (n ? sum / n : 0) - bad;
}

/** What the light looks like away from one piece: equal signatures mean the piece does the same job in both places. */
function signature(t: TraceResult, e: Entity): string {
  const q = (v: number) => Math.round(v * 1000);
  const parts: string[] = [];
  for (const s of t.segments) {
    if (s.hit === e.id) continue;
    parts.push(`${q(s.b.x)},${q(s.b.y)},${q(s.c[0])},${q(s.c[1])},${q(s.c[2])},${s.pol === null ? '' : q(s.pol)},${s.hit ?? ''}`);
  }
  return parts.sort().join(';');
}

export function litCells(t: TraceResult, w: number, h: number): Set<number> {
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

/** Cells within `r` (Chebyshev) of any cell in the set: pieces that act at a distance (gravity) matter there too. */
function grow(cells: Set<number>, r: number, w: number, h: number): Set<number> {
  const out = new Set<number>();
  for (const c of cells) {
    const x = c % w;
    const y = Math.floor(c / w);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (x + i >= 0 && y + j >= 0 && x + i < w && y + j < h) out.add((y + j) * w + x + i);
  }
  return out;
}

export function anglesFor(type: string, step: number): number[] {
  const sym = getType(type).symmetry ?? 360;
  // A symmetry of 360 marks pieces that can't be turned (e.g. black holes): only one angle matters.
  if (getType(type).symmetry === 360) return [0];
  const out: number[] = [];
  for (let a = 0; a < sym; a += step) out.push(a);
  return out;
}

interface TrayPiece {
  key: string;
  type: string;
  params: Record<string, unknown>;
  /** How far from a lit cell the piece can still matter (gravity), in cells. */
  reach: number;
  angles: number[];
  /** Set for a picked-up `free` piece: its entity id. It doesn't count towards par. */
  freeId?: string;
}

export function solve(level: LevelDef, opts: SolveOptions = {}): SolveResult {
  const maxSolutions = opts.maxSolutions ?? 1;
  const maxNodes = opts.maxNodes ?? 200000;
  const { w, h } = level.grid;
  const step = level.rotationStep ?? 15;
  const board = { width: w, height: h };
  const initial = new Session(level).pieces as Entity[];
  const lockOf = (i: number) => level.entities[i].lock;
  const free = initial.filter((_, i) => lockOf(i) === 'free');

  const reachOf = (type: string, params: Record<string, unknown>) => {
    const field = getType(type).field;
    return field ? Math.ceil(field({ id: '', type, x: 0, y: 0, angle: 0, params }).reach) : 0;
  };
  const trayPiece = (type: string, params: Record<string, unknown>, freeId?: string): TrayPiece => ({
    key: freeId ? `#${freeId}` : slotKey(type, params),
    type,
    params,
    reach: reachOf(type, params),
    angles: anglesFor(type, step),
    freeId,
  });
  const inventory: TrayPiece[] = [];
  for (const item of level.inventory) for (let i = 0; i < item.count; i++) inventory.push(trayPiece(item.type, item.params ?? {}));
  const maxPieces = Math.min(opts.maxPieces ?? inventory.length, inventory.length);

  const solutions: SolutionStep[][] = [];
  const seen = new Set<string>();
  let nodes = 0;
  const deadline = opts.maxMs ? Date.now() + opts.maxMs : Infinity;
  let timedOut = false;
  const done = () => {
    if (solutions.length >= maxSolutions || nodes >= maxNodes || timedOut) return true;
    if ((nodes & 255) === 0 && Date.now() > deadline) timedOut = true;
    return timedOut;
  };
  const run = (entities: Entity[]) => {
    nodes++;
    return trace(entities, board);
  };
  const wins = (entities: Entity[], t: TraceResult) => evaluate(entities, t, level.goal).won;
  let nearMisses = 0;

  // One search per choice of which `free` pieces are picked up.
  for (let mask = 0; mask < 1 << free.length && !done(); mask++) {
    const lifted = free.filter((_, i) => mask & (1 << i));
    const base = initial.filter((e) => !lifted.includes(e));
    const turnable = base.filter((e) => {
      const lock = lockOf(initial.indexOf(e));
      return (lock === 'rotate' || lock === 'free') && getType(e.type).symmetry !== 360;
    });
    const tray = [...inventory, ...lifted.map((e) => trayPiece(e.type, e.params, e.id))];
    const used = tray.map(() => false);
    const decided = new Set<Entity>();
    const banned = new Set<string>();
    const cellOf = (e: Entity) => Math.round(e.y) * w + Math.round(e.x);

    const record = (entities: Entity[], t: TraceResult) => {
      const placed = entities.slice(base.length);
      if (!opts.allowSpare) {
        // A solution that still wins without one of its tray pieces is that smaller solution plus a spare piece.
        for (const p of placed) {
          if (tray.some((tp) => tp.freeId === p.id)) continue;
          const without = entities.filter((e) => e !== p);
          if (wins(without, run(without))) return;
        }
      }
      // Picked-up pieces that were not needed have to be put down somewhere harmless.
      const parked: Entity[] = [];
      for (let i = 0; i < tray.length; i++) {
        if (used[i] || !tray[i].freeId) continue;
        const occ = new Set<number>();
        for (const e of [...entities, ...parked]) for (const [x, y] of footprint(e)) occ.add(y * w + x);
        const lit = litCells(t, w, h);
        let spot: Entity | null = null;
        for (let c = 0; c < w * h && !spot; c++) {
          if (occ.has(c) || lit.has(c)) continue;
          const e: Entity = { id: tray[i].freeId!, type: tray[i].type, x: c % w, y: Math.floor(c / w), angle: 0, params: tray[i].params };
          const all = [...entities, ...parked, e];
          if (wins(all, run(all))) spot = e;
        }
        if (!spot) return;
        parked.push(spot);
      }
      const steps: SolutionStep[] = [];
      const keys: string[] = [];
      for (const r of turnable) {
        steps.push({ id: r.id, x: r.x, y: r.y, angle: r.angle });
        // The angle of a piece no light reaches doesn't make a different solution.
        keys.push(`${r.id}@${r.x},${r.y},${t.touched.has(r.id) ? r.angle : '*'}`);
      }
      for (const e of [...placed, ...parked]) {
        const isFree = free.some((f) => f.id === e.id);
        if (isFree) steps.push({ id: e.id, x: e.x, y: e.y, angle: e.angle });
        else steps.push({ type: e.type, params: Object.keys(e.params).length ? e.params : undefined, x: e.x, y: e.y, angle: e.angle });
        keys.push(parked.includes(e) ? `${e.id}@parked` : `${isFree ? e.id : slotKey(e.type, e.params)}@${e.x},${e.y},${t.touched.has(e.id) ? e.angle : '*'}`);
      }
      const key = keys.sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      solutions.push(steps);
    };

    const search = (entities: Entity[], t: TraceResult, count: number) => {
      const ev = evaluate(entities, t, level.goal);
      if (ev.won) {
        record(entities, t);
        return;
      }
      if (ev.targets.every((x) => (x.kind === 'sink' ? x.progress >= 0.75 : true)) && ev.targets.some((x) => x.kind === 'sink')) nearMisses++;
      const lit = litCells(t, w, h);

      // A turnable piece the light has reached: settle its angle now, before anything else.
      const r = turnable.find((e) => !decided.has(e) && lit.has(cellOf(e)));
      if (r) {
        decided.add(r);
        const original = r.angle;
        for (const a of anglesFor(r.type, step)) {
          if (done()) break;
          r.angle = a;
          search(entities, a === original ? t : run(entities), count);
        }
        r.angle = original;
        decided.delete(r);
        return;
      }

      const occ = new Set<number>();
      for (const e of entities) for (const [x, y] of footprint(e)) occ.add(y * w + x);
      const explored: string[] = [];
      const triedKeys = new Set<string>();
      const near = new Map<number, Set<number>>();
      for (let i = 0; i < tray.length && !done(); i++) {
        const piece = tray[i];
        if (used[i] || triedKeys.has(piece.key)) continue;
        if (!piece.freeId && count >= maxPieces) continue;
        triedKeys.add(piece.key);
        used[i] = true;
        if (!near.has(piece.reach)) near.set(piece.reach, piece.reach ? grow(lit, piece.reach, w, h) : lit);
        const sigs = new Set<string>();
        const queue: { e: Entity; t: TraceResult; ban: string; score: number }[] = [];
        for (const cell of near.get(piece.reach)!) {
          if (occ.has(cell)) continue;
          for (const angle of piece.angles) {
            if (done()) break;
            const ban = `${piece.key}@${cell},${angle}`;
            if (banned.has(ban)) continue;
            const e: Entity = { id: piece.freeId ?? `s${entities.length}`, type: piece.type, x: cell % w, y: Math.floor(cell / w), angle, params: piece.params };
            entities.push(e);
            const child = run(entities);
            if (child.touched.has(e.id)) {
              if (opts.hunt) {
                const sig = signature(child, e);
                if (!sigs.has(sig)) {
                  sigs.add(sig);
                  queue.push({ e, t: child, ban, score: progressOf(evaluate(entities, child, level.goal)) });
                }
              } else {
                search(entities, child, piece.freeId ? count : count + 1);
                banned.add(ban);
                explored.push(ban);
              }
            }
            entities.pop();
          }
          if (done()) break;
        }
        queue.sort((a, b) => b.score - a.score);
        for (const q of queue) {
          if (done()) break;
          entities.push(q.e);
          search(entities, q.t, piece.freeId ? count : count + 1);
          entities.pop();
          banned.add(q.ban);
          explored.push(q.ban);
        }
        used[i] = false;
      }
      for (const ban of explored) banned.delete(ban);
    };

    const start = [...base];
    search(start, run(start), 0);
  }
  return { solutions, nodes, exhausted: nodes < maxNodes && !timedOut && solutions.length < maxSolutions, nearMisses };
}
