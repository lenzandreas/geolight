/**
 * The state of one level being played: placed pieces, tray, undo history.
 * Headless (no DOM), so it is shared by the UI, tests and future tools like
 * an editor, a solver or a replay system.
 */
import { evaluate, type Evaluation } from '../core/rules';
import { footprint, getType } from '../core/registry';
import { trace, type TraceResult } from '../core/tracer';
import type { Entity } from '../core/types';
import { wrapAngle } from '../core/math';
import type { LevelDef, LockMode, SolutionStep } from '../level/schema';

export type PieceLock = LockMode | 'tray';

export interface Piece extends Entity {
  lock: PieceLock;
  /** Inventory slot this piece came from (tray pieces only). */
  slot?: string;
}

export interface Slot {
  key: string;
  type: string;
  params: Record<string, unknown>;
  count: number;
}

type Snapshot = Piece[];

const clonePiece = (p: Piece): Piece => ({ ...p, params: { ...p.params } });

export function slotKey(type: string, params: Record<string, unknown> = {}): string {
  const keys = Object.keys(params).sort();
  return keys.length ? `${type}:${keys.map((k) => `${k}=${JSON.stringify(params[k])}`).join(',')}` : type;
}

export class Session {
  readonly level: LevelDef;
  readonly slots: Slot[];
  readonly rotationStep: number;
  pieces: Piece[];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listeners = new Set<() => void>();
  private cache: { trace: TraceResult; evaluation: Evaluation } | null = null;
  private nextId = 1;
  hintsUsed = 0;

  constructor(level: LevelDef) {
    this.level = level;
    this.rotationStep = level.rotationStep ?? 15;
    this.slots = level.inventory.map((i) => ({ key: slotKey(i.type, i.params), type: i.type, params: { ...(i.params ?? {}) }, count: i.count }));
    this.pieces = this.initialPieces();
  }

  private initialPieces(): Piece[] {
    return this.level.entities.map((d, i) => ({
      id: d.id ?? `e${i}`,
      type: d.type,
      x: d.x,
      y: d.y,
      angle: d.angle ?? 0,
      params: { ...(d.params ?? {}) },
      lock: d.lock ?? 'fixed',
    }));
  }

  /* ---------- Queries ---------- */

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(id: string): Piece | undefined {
    return this.pieces.find((p) => p.id === id);
  }

  remaining(key: string): number {
    const slot = this.slots.find((s) => s.key === key);
    if (!slot) return 0;
    return slot.count - this.pieces.filter((p) => p.slot === key).length;
  }

  /** Number of pieces taken from the tray. */
  get placedCount(): number {
    return this.pieces.filter((p) => p.lock === 'tray').length;
  }

  get par(): number {
    return this.level.par ?? this.level.solution?.filter((s) => s.type).length ?? 0;
  }

  canMove(p: Piece): boolean {
    return p.lock === 'tray' || p.lock === 'free';
  }

  canRotate(p: Piece): boolean {
    return p.lock !== 'fixed' && getType(p.type).symmetry !== 360;
  }

  inGrid(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.level.grid.w && y < this.level.grid.h;
  }

  /** Piece occupying a cell, if any. */
  pieceAt(x: number, y: number, ignoreId?: string): Piece | undefined {
    return this.pieces.find((p) => p.id !== ignoreId && footprint(p).some(([cx, cy]) => cx === x && cy === y));
  }

  canPlaceAt(x: number, y: number, ignoreId?: string): boolean {
    return this.inGrid(x, y) && !this.pieceAt(x, y, ignoreId);
  }

  /** Trace and evaluate the current state (cached until the next change). */
  result(): { trace: TraceResult; evaluation: Evaluation } {
    if (!this.cache) {
      const t = trace(this.pieces, { width: this.level.grid.w, height: this.level.grid.h });
      this.cache = { trace: t, evaluation: evaluate(this.pieces, t, this.level.goal) };
    }
    return this.cache;
  }

  get won(): boolean {
    return this.result().evaluation.won;
  }

  /* ---------- Mutations (all undoable) ---------- */

  place(key: string, x: number, y: number, angle = 0): Piece | null {
    const slot = this.slots.find((s) => s.key === key);
    if (!slot || this.remaining(key) <= 0 || !this.canPlaceAt(x, y)) return null;
    this.checkpoint();
    const p: Piece = { id: `p${this.nextId++}`, type: slot.type, x, y, angle: wrapAngle(angle), params: { ...slot.params }, lock: 'tray', slot: key };
    this.pieces.push(p);
    this.changed();
    return p;
  }

  move(id: string, x: number, y: number): boolean {
    const p = this.get(id);
    if (!p || !this.canMove(p) || !this.canPlaceAt(x, y, id)) return false;
    if (p.x === x && p.y === y) return true;
    this.checkpoint();
    p.x = x;
    p.y = y;
    this.changed();
    return true;
  }

  setAngle(id: string, angle: number): boolean {
    const p = this.get(id);
    if (!p || !this.canRotate(p)) return false;
    const a = wrapAngle(Math.round(angle / this.rotationStep) * this.rotationStep);
    if (a === p.angle) return true;
    this.checkpoint();
    p.angle = a;
    this.changed();
    return true;
  }

  rotate(id: string, steps: number): boolean {
    const p = this.get(id);
    return !!p && this.setAngle(id, p.angle + steps * this.rotationStep);
  }

  /** Return a tray piece to the inventory. */
  remove(id: string): boolean {
    const i = this.pieces.findIndex((p) => p.id === id && p.lock === 'tray');
    if (i < 0) return false;
    this.checkpoint();
    this.pieces.splice(i, 1);
    this.changed();
    return true;
  }

  reset(): void {
    this.checkpoint();
    this.pieces = this.initialPieces();
    this.changed();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(this.pieces.map(clonePiece));
    this.pieces = s;
    this.changed();
    return true;
  }

  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(this.pieces.map(clonePiece));
    this.pieces = s;
    this.changed();
    return true;
  }

  /* ---------- Solutions & hints ---------- */

  /** Does the current state already contain this solution step? */
  stepSatisfied(step: SolutionStep): boolean {
    const symmetry = (type: string) => getType(type).symmetry ?? 360;
    const sameAngle = (a: number, b: number, type: string) => wrapAngle(a - b) % symmetry(type) === 0;
    if (step.id) {
      const p = this.get(step.id);
      return !!p && p.x === step.x && p.y === step.y && sameAngle(p.angle, step.angle, p.type);
    }
    const key = slotKey(step.type!, step.params);
    return this.pieces.some((p) => p.slot === key && p.x === step.x && p.y === step.y && sameAngle(p.angle, step.angle, p.type));
  }

  /** The next solution step the player hasn't done yet. */
  nextHint(): SolutionStep | null {
    return this.level.solution?.find((s) => !this.stepSatisfied(s)) ?? null;
  }

  /** Apply a full solution from a clean state (tests, demo mode). */
  applySolution(steps: SolutionStep[] = this.level.solution ?? []): void {
    for (const s of steps) {
      if (s.id) {
        const p = this.get(s.id);
        if (!p) throw new Error(`solution: no piece ${s.id}`);
        if (p.x !== s.x || p.y !== s.y) this.move(s.id, s.x, s.y);
        this.setAngle(s.id, s.angle);
      } else {
        const key = slotKey(s.type!, s.params);
        if (!this.place(key, s.x, s.y, s.angle)) throw new Error(`solution: cannot place ${key} at ${s.x},${s.y}`);
      }
    }
  }

  private checkpoint(): void {
    this.undoStack.push(this.pieces.map(clonePiece));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  private changed(): void {
    this.cache = null;
    for (const fn of this.listeners) fn();
  }
}

/** Stars: 3 for a perfect solve, −1 for extra pieces, −1 for using hints. */
export function starsFor(session: Session): number {
  let s = 3;
  if (session.par > 0 && session.placedCount > session.par) s--;
  if (session.hintsUsed > 0) s--;
  return Math.max(1, s);
}
