/**
 * Level-design tools: a text picture of a board with its light, and a check that
 * says whether a level is sound, how hard it is and what to change. They exist so
 * that an author who cannot see the canvas or do optics in their head (a script,
 * a language model) can still design by experiment. `scripts/level.mjs` is the
 * command line for them; see docs/LEVEL-DESIGN.md.
 */
import { evaluate, type Evaluation } from '../core/rules';
import { footprint, getType, hasType } from '../core/registry';
import { trace, type TraceResult } from '../core/tracer';
import type { Entity } from '../core/types';
import { Session, slotKey, starsFor } from '../game/session';
import type { LevelDef, SolutionStep } from './schema';
import { pointSegmentDistance } from '../core/geometry';
import { anglesFor, litCells, solve } from './solver';
import { parseLevel } from './validate';
import { ancestors, featuredPieces, pieceKind, piecesUsed, type WorldDef } from './worlds';

/* ---------- Experiments: a level plus some moves ---------- */

export interface Moves {
  /** Apply the level's reference solution first. */
  solve?: boolean;
  /** `type@x,y@angle`, with parameters as `type:key=value,key=value@x,y@angle`. */
  place?: string[];
  /** `id@angle` */
  turn?: string[];
  /** `id@x,y` */
  move?: string[];
}

function parseValue(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** The board after the moves, and notes about moves the player could not make. */
export function setUp(level: LevelDef, moves: Moves = {}): { entities: Entity[]; notes: string[]; placed: number } {
  const s = new Session(level);
  const notes: string[] = [];
  if (moves.solve) s.applySolution();
  for (const m of moves.turn ?? []) {
    const [id, angle] = m.split('@');
    const p = s.get(id);
    if (!p) throw new Error(`--turn ${m}: no piece with id "${id}"`);
    if (!s.setAngle(id, Number(angle))) {
      notes.push(`${id} is locked; turned it anyway (a player could not)`);
      p.angle = Number(angle);
    }
  }
  for (const m of moves.move ?? []) {
    const [id, at] = m.split('@');
    const [x, y] = at.split(',').map(Number);
    const p = s.get(id);
    if (!p) throw new Error(`--move ${m}: no piece with id "${id}"`);
    if (!s.move(id, x, y)) {
      notes.push(`${id} cannot be moved by a player; moved it anyway`);
      p.x = x;
      p.y = y;
    }
  }
  const entities = s.pieces as Entity[];
  let extra = 0;
  for (const m of moves.place ?? []) {
    const [spec, at, angle = '0'] = m.split('@');
    const [type, paramText] = spec.split(':');
    if (!hasType(type)) throw new Error(`--place ${m}: unknown piece type "${type}"`);
    const params: Record<string, unknown> = {};
    for (const kv of paramText ? paramText.split(',') : []) {
      const [k, v] = kv.split('=');
      params[k] = parseValue(v);
    }
    const [x, y] = (at ?? '').split(',').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`--place ${m}: write it as type@x,y@angle`);
    if (!s.inGrid(x, y)) throw new Error(`--place ${m}: outside the ${level.grid.w}x${level.grid.h} grid`);
    if (s.pieceAt(x, y)) throw new Error(`--place ${m}: cell ${x},${y} is taken by ${s.pieceAt(x, y)!.type} (id ${s.pieceAt(x, y)!.id}). To turn a pre-placed piece use --turn ${s.pieceAt(x, y)!.id}@angle`);
    if (!s.place(slotKey(type, params), x, y, Number(angle))) {
      if (!notes.some((n) => n.startsWith('Some placed'))) notes.push('Some placed pieces are not in the tray (yet). That is fine while you are designing.');
      entities.push({ id: `x${extra++}`, type, x, y, angle: Number(angle), params });
    }
  }
  return { entities, notes, placed: s.placedCount + extra };
}

/* ---------- Text picture ---------- */

const CODES: Record<string, string> = {
  bulb: 'Bu', sun: 'Su', wall: '##', slit: '][', photocell: 'Pc', mirror: 'Mi', splitter: 'Sp', curvedMirror: 'Cm', filter: 'Fi',
  prism: 'Pr', block: 'Gl', polarizer: 'Po', blackHole: '@@', grating: 'Gr', blocker: 'Bl', heater: 'Hp',
};
const LEGEND: Record<string, string> = {
  'L>': 'laser (arrow = beam direction; L* = slanted)', Bu: 'bulb', Su: 'sunlight', 'O ': 'ring, not full', 'O*': 'ring, full', '! ': 'sensor, dark',
  '!X': 'sensor, TRIPPED', '##': 'wall', '[]': 'gate, shut', '[ ': 'gate, open', '][': 'slit', Pc: 'solar cell', Mi: 'mirror', Sp: 'splitter', Le: 'lens',
  Ld: 'diverging lens', Cm: 'concave mirror', Fi: 'filter', Pr: 'prism', Gl: 'glass block', Po: 'polarizer', '@@': 'black hole', Gr: 'grating', Bl: 'shade', Hp: 'hot plate (warm air in front of it)', '# ': 'screen, picture wrong', '#*': 'screen, picture right',
  '--': 'light', '| ': 'light', '\\ ': 'light', '/ ': 'light', '~ ': 'light at another angle', '+ ': 'light in several directions', '::': 'diffuse light', '. ': 'empty',
};

const fmt = (v: number, digits = 3) => String(Number(v.toFixed(digits)));
const rgbText = (c: readonly number[]) => (['R', 'G', 'B'] as const).map((n, i) => (c[i] > 5e-4 ? `${n}${fmt(c[i])}` : '')).filter(Boolean).join(' ') || 'none';
const stepText = (s: SolutionStep) => `${s.id ?? slotKey(s.type!, s.params)}@${s.x},${s.y}@${s.angle}`;

function code(e: Entity, ev: Evaluation, t: TraceResult): string {
  if (e.type === 'laser') {
    const a = ((e.angle % 360) + 360) % 360;
    return 'L' + (a === 0 ? '>' : a === 90 ? 'v' : a === 180 ? '<' : a === 270 ? '^' : '*');
  }
  const status = ev.targets.find((x) => x.id === e.id);
  if (e.type === 'sink') return status?.ok ? 'O*' : 'O ';
  if (e.type === 'screen') return status?.ok ? '#*' : '# ';
  if (e.type === 'sensor') return status?.ok ? '! ' : '!X';
  if (e.type === 'gate') return t.open.has(e.id) ? '[ ' : '[]';
  if (e.type === 'lens') return pieceKind(e.type, e.params) === 'divergingLens' ? 'Ld' : 'Le';
  return CODES[e.type] ?? '??';
}

/** The board as text: one two-letter code per cell, light drawn where it passes through empty cells. */
export function picture(level: LevelDef, entities: Entity[], t: TraceResult, ev: Evaluation): string {
  const { w, h } = level.grid;
  const grid: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => '. '));
  const dirs: Set<string>[] = Array.from({ length: w * h }, () => new Set<string>());
  const counts = new Array<number>(w * h).fill(0);
  for (const s of t.segments) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ang = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 180;
    const glyph = [['--', 0], ['\\ ', 45], ['| ', 90], ['/ ', 135], ['--', 180]].find(([, a]) => Math.abs(ang - (a as number)) < 8)?.[0] as string | undefined;
    const seen = new Set<number>();
    const n = Math.max(1, Math.ceil(len / 0.1));
    for (let i = 0; i <= n; i++) {
      const x = Math.floor(s.a.x + (dx * i) / n);
      const y = Math.floor(s.a.y + (dy * i) / n);
      if (x < 0 || y < 0 || x >= w || y >= h || seen.has(y * w + x)) continue;
      seen.add(y * w + x);
      dirs[y * w + x].add(glyph ?? '~ ');
      counts[y * w + x]++;
    }
  }
  for (let c = 0; c < w * h; c++) {
    if (!dirs[c].size) continue;
    grid[Math.floor(c / w)][c % w] = counts[c] > 8 ? '::' : dirs[c].size > 1 ? '+ ' : [...dirs[c]][0];
  }
  const used = new Set<string>();
  for (const e of entities) {
    const k = code(e, ev, t);
    for (const [x, y] of footprint(e)) if (x >= 0 && y >= 0 && x < w && y < h) grid[y][x] = k;
  }
  for (const row of grid) for (const k of row) used.add(k.startsWith('L') && k !== 'Le' && k !== 'Ld' ? 'L>' : k);
  const pad = (v: number | string) => String(v).padStart(2);
  const lines = [`   x ${Array.from({ length: w }, (_, x) => pad(x)).join(' ')}`];
  grid.forEach((row, y) => lines.push(`y ${pad(y)}  ${row.map((k) => k).join(' ')}`));
  lines.push('', 'Legend: ' + [...used].filter((k) => LEGEND[k]).map((k) => `${k.trim()} = ${LEGEND[k]}`).join(', '));
  return lines.join('\n');
}

function polText(pol: number | null): string {
  return pol === null ? '' : `, polarized ${fmt(pol, 1)}°`;
}

/** Everything a designer needs to know about one state of the board. */
export function describe(level: LevelDef, moves: Moves = {}): string {
  const { entities, notes, placed } = setUp(level, moves);
  const board = { width: level.grid.w, height: level.grid.h };
  const t = trace(entities, board);
  const ev = evaluate(entities, t, level.goal);
  const out: string[] = [`${level.id}: ${level.grid.w}x${level.grid.h} cells. x grows to the right, y grows DOWN. Angle 0 = right, 90 = down, 180 = left, 270 = up.`, ''];
  out.push(picture(level, entities, t, ev), '');
  for (const n of notes) out.push(`Note: ${n}`);

  out.push('Pieces on the board (walls left out):');
  entities.forEach((e, i) => {
    if (e.type === 'wall') return;
    const lock = (e as { lock?: string }).lock ?? level.entities[i]?.lock ?? 'fixed';
    const params = Object.keys(e.params).length ? ' ' + JSON.stringify(e.params) : '';
    const turnable = getType(e.type).symmetry !== 360 && !getType(e.type).emit;
    out.push(`  ${e.id.padEnd(4)} ${e.type} at ${e.x},${e.y}${turnable || getType(e.type).emit ? ` angle ${e.angle}` : ''} [${lock === 'tray' ? 'from the tray' : lock}]${params}`);
  });
  const left = level.inventory.map((i) => `${i.count}x ${slotKey(i.type, i.params)}`).join(', ');
  out.push(`Tray at the start: ${left || 'empty'}. Tray pieces placed now: ${placed}.`, '');

  out.push('Targets:');
  for (const s of ev.targets) {
    const e = entities.find((x) => x.id === s.id)!;
    const got = `gets ${rgbText(s.received)} (total ${fmt(s.received[0] + s.received[1] + s.received[2])})`;
    if (s.pixels) {
      // One letter per pixel: . dark, w white, r/g/b/y/c/m a colour, ? neither lit nor dark enough.
      const need = ((e.params.need as number | undefined) ?? 0.3) / 3;
      const limit = (e.params.limit as number | undefined) ?? 0.02;
      const names: Record<string, string> = { '000': '.', '111': 'w', '100': 'r', '010': 'g', '001': 'b', '110': 'y', '011': 'c', '101': 'm' };
      const shows = s.pixels.map((p) => (p.got.some((v) => v > limit && v + 1e-6 < need) ? '?' : names[p.got.map((v) => (v > limit ? 1 : 0)).join('')])).join('');
      out.push(`  screen ${s.id} at ${e.x},${e.y}: wants "${e.params.pattern}", shows "${shows}" (per pixel: ${s.pixels.map((p) => fmt(p.got[0] + p.got[1] + p.got[2])).join(' ')}) -> ${s.ok ? 'RIGHT' : `${s.value} of ${s.threshold} pixels right`}`);
    } else if (s.kind === 'sink') {
      const want = [`needs ${fmt(s.threshold)}`, e.params.color ? `of ${JSON.stringify(e.params.color)}` : '', e.params.each ? 'each colour equally' : '', e.params.strict ? 'strict' : '', e.params.pol !== undefined && e.params.pol !== null ? `polarized ${e.params.pol}°` : ''].filter(Boolean).join(', ');
      out.push(`  ring ${s.id} at ${e.x},${e.y}: ${want}; ${got}, counts ${fmt(s.value)} -> ${s.ok ? 'FULL' : s.contaminated ? 'SPOILED by wrong light' : `${Math.round(s.progress * 100)}%`}`);
      const pols = [...new Set((t.receptions.get(s.id) ?? []).map((r) => (r.pol === null ? 'unpolarized' : `${fmt(r.pol, 1)}°`)))];
      if (pols.length && (e.params.pol !== undefined || pols.some((p) => p !== 'unpolarized'))) out.push(`      arriving polarization: ${pols.join(', ')}`);
    } else if (s.kind === 'sensor') out.push(`  sensor ${s.id} at ${e.x},${e.y}: limit ${fmt(s.threshold)}; ${got} -> ${s.ok ? 'dark' : 'TRIPPED'}`);
    else out.push(`  solar cell ${s.id} at ${e.x},${e.y}: needs ${fmt(s.threshold)}; ${got} -> ${s.value + 1e-9 >= s.threshold ? 'powered' : 'off'}`);
  }
  out.push('', ev.won ? `RESULT: SOLVED with ${placed} tray piece(s).` : 'RESULT: not solved.', '');

  const beams = t.segments.filter((s) => s.hit !== undefined || Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 0.3);
  if (beams.length <= 40) {
    out.push('Beams, in the order the light travels (a ring can be put where a beam ends or passes):');
    for (const s of beams) {
      const ang = ((Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI + 360) % 360;
      const end = s.hit ? `${entities.find((e) => e.id === s.hit)?.type ?? '?'} ${s.hit}` : 'the edge (or bends on)';
      out.push(`  from cell ${Math.floor(s.a.x)},${Math.floor(s.a.y)} heading ${fmt(ang, 1)}° to cell ${Math.min(level.grid.w - 1, Math.floor(s.b.x))},${Math.min(level.grid.h - 1, Math.floor(s.b.y))}: ${rgbText(s.c)}${polText(s.pol)}; ends on ${end}`);
    }
  } else out.push(`(${t.segments.length} light segments: too many to list. Diffuse light; read the Targets table.)`);
  return out.join('\n');
}

/* ---------- A player who chases progress ---------- */

/**
 * How good a board looks to a hasty player: fuller rings are better, and for a ring
 * that gets nothing yet, light passing closer to it is better. A tripped sensor looks bad.
 */
export function looksGood(entities: Entity[], t: TraceResult, ev: Evaluation, w: number, h: number): number {
  let sum = 0;
  let n = 0;
  let bad = 0;
  const diagonal = Math.hypot(w, h);
  for (const s of ev.targets) {
    if (s.kind === 'sensor' && !s.ok) bad += 0.5;
    if (s.kind !== 'sink') continue;
    n++;
    // Light of the wrong colour on a strict ring still looks like being nearly there.
    if (s.contaminated) {
      sum += 0.5;
      continue;
    }
    if (s.value > 1e-6) {
      sum += 0.5 + 0.5 * s.progress;
      continue;
    }
    const e = entities.find((x) => x.id === s.id)!;
    const c = { x: e.x + 0.5, y: e.y + 0.5 };
    let d = diagonal;
    for (const seg of t.segments) d = Math.min(d, pointSegmentDistance(c, seg.a, seg.b));
    sum += 0.5 * (1 - d / diagonal);
  }
  return (n ? sum / n : 0) - bad;
}

/**
 * Plays the level the way a hasty player does: make the move that fills the rings most,
 * keeping the `width` best boards after every move. Returns the smallest of the given
 * widths that reaches a win within par, or null if none does. Width 1 means the level
 * solves itself; null means the best-looking moves lead away from the solution.
 */
export function greedyWidth(level: LevelDef, par: number, widths: number[], ms = 15000): number | null {
  const { w, h } = level.grid;
  const step = level.rotationStep ?? 15;
  const board = { width: w, height: h };
  const start = new Session(level).pieces as Entity[];
  const turnable = new Set(start.filter((_, i) => level.entities[i].lock === 'rotate' || level.entities[i].lock === 'free').filter((e) => getType(e.type).symmetry !== 360).map((e) => e.id));
  const slots = level.inventory.map((i) => ({ key: slotKey(i.type, i.params), type: i.type, params: i.params ?? {}, count: i.count }));
  const deadline = Date.now() + ms;
  interface State { entities: Entity[]; used: number[]; turned: Set<string>; score: number; t: TraceResult }
  const keyOf = (es: Entity[]) => es.map((e) => `${e.type}${JSON.stringify(e.params)}@${e.x},${e.y},${e.angle}`).sort().join('|');
  for (const width of widths) {
    const first = trace(start, board);
    let won = false;
    let frontier: State[] = [{ entities: start, used: slots.map(() => 0), turned: new Set(), score: 0, t: first }];
    const seen = new Set<string>();
    for (let depth = 0; depth < par + turnable.size && frontier.length; depth++) {
      const next: State[] = [];
      for (const st of frontier) {
        const lit = litCells(st.t, w, h);
        const occ = new Set<number>();
        for (const e of st.entities) for (const [x, y] of footprint(e)) occ.add(y * w + x);
        const consider = (entities: Entity[], used: number[], turned: Set<string>, id: string): boolean => {
          if (Date.now() > deadline) return false;
          const k = keyOf(entities);
          if (seen.has(k)) return false;
          seen.add(k);
          const t = trace(entities, board);
          if (!t.touched.has(id) && !turned.has(id)) return false;
          const ev = evaluate(entities, t, level.goal);
          if (ev.won) return true;
          next.push({ entities, used, turned, score: looksGood(entities, t, ev, w, h), t });
          return false;
        };
        for (const e of st.entities) {
          if (!turnable.has(e.id) || st.turned.has(e.id) || !lit.has(Math.round(e.y) * w + Math.round(e.x))) continue;
          for (const a of anglesFor(e.type, step)) {
            if (a === e.angle) continue;
            if (consider(st.entities.map((x) => (x === e ? { ...x, angle: a } : x)), st.used, new Set([...st.turned, e.id]), e.id)) return width;
          }
        }
        if (st.used.reduce((a, b) => a + b, 0) >= par) continue;
        slots.forEach((slot, i) => {
          if (st.used[i] >= slot.count) return;
          const field = getType(slot.type).field;
          const reach = field ? Math.ceil(field({ id: '', type: slot.type, x: 0, y: 0, angle: 0, params: slot.params }).reach) : 0;
          for (let c = 0; c < w * h; c++) {
            if (occ.has(c)) continue;
            const x = c % w;
            const y = Math.floor(c / w);
            let near = lit.has(c);
            for (let dx = -reach; dx <= reach && !near; dx++) for (let dy = -reach; dy <= reach && !near; dy++) near = x + dx >= 0 && x + dx < w && lit.has((y + dy) * w + x + dx);
            if (!near) continue;
            for (const a of anglesFor(slot.type, step)) {
              const id = `g${st.entities.length}`;
              const used = st.used.map((n, j) => (j === i ? n + 1 : n));
              if (consider([...st.entities, { id, type: slot.type, x, y, angle: a, params: slot.params }], used, st.turned, id)) won = true;
            }
          }
        });
        if (won) return width;
      }
      next.sort((a, b) => b.score - a.score);
      frontier = next.slice(0, width);
    }
    if (Date.now() > deadline) return null;
  }
  return null;
}

/* ---------- The check ---------- */

export interface CheckOptions {
  /** Folder name of the level's world, to check which pieces it may use. */
  world?: string;
  worlds?: WorldDef[];
  /** Ids already used by other levels. */
  takenIds?: string[];
  /** Time per search stage in milliseconds (default 15000). */
  ms?: number;
}

export interface CheckResult {
  ok: boolean;
  /** 0–8: how many of the things that make a level hard it has. */
  score: number;
  /** The level meets the bar for a hard level: challenge 6 or more and exactly one winning layout, fully counted. */
  bar: boolean;
  text: string;
}

function applySteps(level: LevelDef, steps: SolutionStep[]): { entities: Entity[]; t: TraceResult; ev: Evaluation } {
  const s = new Session(level);
  s.applySolution(steps);
  const r = s.result();
  return { entities: s.pieces, t: r.trace, ev: r.evaluation };
}

/**
 * The idea behind a solution: which lines the light travels along, in which colour and
 * polarization. Sliding a filter along its beam or turning it a little gives the same key;
 * taking another route does not.
 */
export function ideaKey(level: LevelDef, steps: SolutionStep[]): string {
  const { t, entities } = applySteps(level, steps);
  const q = (v: number, m: number) => Math.round(v * m);
  // Only light that ends up in a ring or a solar cell is part of the idea; stray beams are not.
  const useful = new Array<boolean>(t.segments.length).fill(false);
  const goals = new Set(entities.filter((e) => e.type === 'sink' || e.type === 'screen' || e.type === 'photocell').map((e) => e.id));
  t.segments.forEach((s, i) => {
    if (!s.hit || !goals.has(s.hit)) return;
    for (let j: number | undefined = i; j !== undefined && !useful[j]; j = t.segments[j].parent) useful[j] = true;
  });
  const lines = new Set<string>();
  t.segments.forEach((s, i) => {
    if (!useful[i]) return;
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    // Distance of the line from the origin; together with the heading it names the line whatever piece cuts it.
    const offset = (s.a.x * dy - s.a.y * dx) / len;
    lines.add(`${q((Math.atan2(dy, dx) * 180) / Math.PI, 2)},${q(offset, 50)},${q(s.c[0], 200)},${q(s.c[1], 200)},${q(s.c[2], 200)},${s.pol === null ? '' : q(s.pol, 1)}`);
  });
  return [...lines].sort().join(';');
}

/** Challenge score a level needs to count as hard. */
export const BAR_SCORE = 6;

export function check(raw: unknown, opts: CheckOptions = {}): CheckResult {
  const out: string[] = [];
  const errors: string[] = [];
  const advice: string[] = [];
  let barNotes: string[] = ['the check did not get as far as the challenge score'];
  const done = (score = 0): CheckResult => {
    out.push('');
    if (errors.length) {
      out.push(`VERDICT: FAIL. Fix these ${errors.length} problem(s), then run the check again:`);
      errors.forEach((e, i) => out.push(`  ${i + 1}. ${e}`));
    } else out.push(`VERDICT: PASS, challenge ${score}/8 (${score >= 5 ? 'challenging' : score >= 3 ? 'medium' : 'gentle'}).`);
    if (!errors.length && score < BAR_SCORE) barNotes.push(`the challenge is ${score}/8, the bar is ${BAR_SCORE}/8`);
    const bar = !errors.length && !barNotes.length;
    if (!errors.length) out.push(bar ? 'BAR: MET. This level is hard enough. Stop changing it.' : `BAR: NOT MET (${barNotes.join('; ')}).`);
    if (advice.length) {
      out.push('', errors.length ? 'How to fix:' : 'To make it harder (most important first):');
      advice.forEach((a) => out.push(`  - ${a}`));
    }
    return { ok: !errors.length, score, bar, text: out.join('\n') };
  };

  /* 1. The file itself. */
  let level: LevelDef;
  try {
    level = parseLevel(raw);
  } catch (e) {
    errors.push((e as Error).message);
    return done();
  }
  const ms = opts.ms ?? 15000;
  const { w, h } = level.grid;
  out.push(`Checking ${level.id} (${w}x${h}).`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(level.id)) errors.push(`id "${level.id}" must be lower-case words joined by hyphens`);
  if (opts.takenIds?.includes(level.id)) errors.push(`id "${level.id}" is already used by another level`);
  if (!level.name.de) errors.push('name.de (German name) is missing');
  if (!level.intro?.en || !level.intro?.de) errors.push('intro.en and intro.de are needed: one or two sentences that hint at the idea without giving the placement away');
  const cells = new Map<number, string>();
  let session: Session;
  try {
    session = new Session(level);
    for (const p of session.pieces) {
      for (const [x, y] of footprint(p)) {
        if (cells.has(y * w + x)) errors.push(`${p.type} at ${p.x},${p.y} overlaps ${cells.get(y * w + x)} in cell ${x},${y}`);
        cells.set(y * w + x, p.type);
        if (x >= w || y >= h) errors.push(`${p.type} at ${p.x},${p.y} sticks out of the grid`);
      }
    }
  } catch (e) {
    errors.push(`cannot set up the board: ${(e as Error).message}`);
    return done();
  }
  if (!level.entities.some((e) => getType(e.type).emit)) errors.push('there is no light source (laser, bulb or sun)');
  if (!level.entities.some((e) => e.type === 'sink' || e.type === 'screen')) errors.push('there is no ring (sink) or screen');
  for (const item of level.inventory) if (!pieceKind(item.type, item.params)) errors.push(`${item.type} cannot be a tray piece`);
  if (opts.world && opts.worlds) {
    const world = opts.worlds.find((x) => x.id === opts.world);
    if (!world) errors.push(`the folder "${opts.world}" is not a world in src/levels/worlds.json`);
    else {
      const known = new Set(opts.worlds.filter((x) => ancestors(opts.worlds!, world.id).has(x.id)).map((x) => x.object));
      if (world.object) known.add(world.object);
      // A shade is the one extra piece shadow levels (levels with a screen) may use.
      if (level.entities.some((e) => e.type === 'screen')) known.add('blocker');
      const used = piecesUsed(level);
      for (const p of featuredPieces(opts.worlds, world)) if (!used.has(p)) errors.push(`every level of world "${world.id}" must use a ${p} (in the tray or pre-placed)`);
      for (const p of used) if (!known.has(p)) errors.push(`world "${world.id}" may not use ${p}. Allowed pieces: ${[...known].join(', ')}`);
    }
  }
  if (errors.length) return done();

  /* 2. Start state and reference solution. */
  const solution = level.solution ?? [];
  if (session.won) errors.push('the level is already solved before the player does anything');
  if (!solution.length) {
    errors.push('there is no "solution". Build the solved board with `show --place ...`, then copy the placements into "solution"');
    return done();
  }
  let solved: ReturnType<typeof applySteps>;
  try {
    solved = applySteps(level, solution);
  } catch (e) {
    errors.push(`the reference solution cannot be applied: ${(e as Error).message}. Each step must be a tray piece ({type,x,y,angle}) or a pre-placed piece with lock "rotate"/"free" ({id,x,y,angle})`);
    return done();
  }
  if (!solved.ev.won) {
    errors.push('the reference solution does not win. Run `show <file> --solve` and read the Targets table');
    return done();
  }
  const par = session.par;
  const trayCount = level.inventory.reduce((n, i) => n + i.count, 0);
  const placedInSolution = solution.filter((s) => s.type).length;
  if (placedInSolution > par) errors.push(`the reference solution places ${placedInSolution} pieces but par is ${par}; it must reach 3 stars`);
  {
    const s = new Session(level);
    s.applySolution();
    if (starsFor(s) !== 3 || s.nextHint()) errors.push('the reference solution does not earn 3 stars, or it lists the same step twice');
  }
  for (const step of solution) {
    // A step that the win does not need makes a wrong hint.
    const rest = solution.filter((x) => x !== step);
    try {
      if (applySteps(level, rest).ev.won) errors.push(`solution step ${stepText(step)} is not needed: the level is won without it. Remove the step (and lower par) or make the piece necessary`);
    } catch {
      /* the rest is not applicable on its own: fine */
    }
  }
  if (errors.length) return done();
  out.push(`Reference solution wins. Par ${par}, tray ${trayCount} piece(s)${trayCount > par ? ` (${trayCount - par} decoy)` : ''}.`);

  /* 3. Shortcuts: can it be won with fewer pieces than par? */
  const diffuse = level.entities.some((e) => e.type === 'bulb' || e.type === 'sun');
  const unwanted: SolutionStep[][] = [];
  let proven = true;
  for (let k = 0; k < par; k++) {
    let r = solve(level, { maxPieces: k, maxSolutions: 3, maxNodes: Infinity, maxMs: ms });
    let how = 'exact search';
    if (!r.solutions.length && !r.exhausted) {
      r = solve(level, { maxPieces: k, maxSolutions: 3, maxNodes: Infinity, maxMs: ms, hunt: true });
      how = r.exhausted ? 'hunt, whole reduced space' : 'hunt, ran out of time';
      proven = false;
    }
    if (r.solutions.length) {
      errors.push(`SHORTCUT: the level can be won with ${k} tray piece(s), par is ${par}. For example: ${r.solutions.slice(0, 3).map((s) => s.map(stepText).join(' + ') || '(turning only)').join('   OR   ')}`);
      unwanted.push(...r.solutions);
      break;
    }
    out.push(`No win with ${k} tray piece(s) (${how}, ${r.nodes} boards tried).`);
  }

  /* 4. How many different par solutions? (Not worth counting while a shortcut is open.) */
  const shortcut = errors.length > 0;
  let par1 = shortcut ? { solutions: [], nodes: 0, exhausted: true, nearMisses: 0 } : solve(level, { maxPieces: par, maxSolutions: 40, maxNodes: Infinity, maxMs: ms });
  let counted = par1.exhausted ? 'exact' : 'partial';
  if (!par1.exhausted && par1.solutions.length < 40) {
    const hunted = solve(level, { maxPieces: par, maxSolutions: 40, maxNodes: Infinity, maxMs: ms, hunt: true });
    if (hunted.solutions.length >= par1.solutions.length) {
      par1 = hunted;
      counted = hunted.exhausted ? 'hunt' : 'partial';
    }
  }
  const refLayout = ideaKey(level, solution);
  const layouts = new Map<string, SolutionStep[]>();
  for (const s of par1.solutions) {
    const k = ideaKey(level, s);
    if (!layouts.has(k)) layouts.set(k, s);
  }
  const others = [...layouts].filter(([k]) => k !== refLayout);
  const total = others.length + 1;
  if (!shortcut) out.push(`Par solutions: ${total}${counted === 'partial' ? ' or more (the search ran out of time, so there may be others; --deep searches longer)' : counted === 'hunt' ? ' (hunt)' : ''} different layout(s), the reference one included. Placements that leave the same light (a piece slid along its beam) count once.`);
  others.slice(0, 5).forEach(([, s]) => out.push(`  other: ${s.filter((x) => x.type || solution.some((y) => y.id === x.id)).map(stepText).join(' + ')}`));
  const LOOSE = 4;
  const loose = total >= LOOSE;
  if (loose && !shortcut) out.push(`LOOSE: ${total}${counted === 'partial' ? '+' : ''} different layouts win at par, so almost any reasonable try works. A hard level has 1 to 3. The challenge score is capped at 2 until this is fixed.`);
  unwanted.push(...others.map(([, s]) => s));

  /* Where would a wall or sensor remove unwanted solutions without touching the reference light? */
  if (unwanted.length) {
    const refLit = litCells(solved.t, w, h);
    const refOcc = new Set<number>();
    for (const e of solved.entities) for (const [x, y] of footprint(e)) refOcc.add(y * w + x);
    const tally = new Map<number, number>();
    for (const u of unwanted) {
      let a: ReturnType<typeof applySteps>;
      try {
        a = applySteps(level, u);
      } catch {
        continue;
      }
      const occ = new Set<number>();
      for (const e of a.entities) for (const [x, y] of footprint(e)) occ.add(y * w + x);
      for (const c of litCells(a.t, w, h)) if (!refLit.has(c) && !refOcc.has(c) && !occ.has(c)) tally.set(c, (tally.get(c) ?? 0) + 1);
    }
    const best = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (best.length && !diffuse) {
      advice.push(`Block the unwanted solutions. Their light crosses these cells, the reference solution's light does not: ${best.map(([c, n]) => `${c % w},${Math.floor(c / w)} (stops ${n} of ${unwanted.length})`).join('; ')}. Put a wall there ({"type":"wall","x":X,"y":Y}), or a sensor if the light should stay visible.`);
    }
    advice.push('Other ways to remove unwanted solutions: raise a ring\'s "required" so the weaker route is not enough; make a ring "strict"; move a ring into a niche between walls so only one direction reaches it; take a piece out of the tray.');
    if (errors.some((e) => e.startsWith('SHORTCUT'))) advice.push(`Or accept the shorter solution: make it the "solution" and set par to match. Do this only if it is still an interesting idea.`);
  }
  if (errors.length) return done();

  /* 5. What makes it hard? */
  let score = 0;
  const point = (yes: boolean, label: string, hint: string, worth = 1) => {
    out.push(`  [${yes ? 'x' : ' '}] ${label}`);
    if (yes) score += worth;
    else advice.push(hint);
  };
  out.push('', 'Challenge checklist:');
  point(par >= 3 || solution.filter((s) => s.id).length >= 3, `needs 3 or more tray pieces, or 3 or more pieces to turn (par ${par}, ${solution.filter((s) => s.id).length} to turn)`, 'Add a step: a second ring, a pre-placed piece with lock "rotate" at a wrong angle, or a wall that forces one more turn.');
  point(trayCount > par, `decoys in the tray (${trayCount - par})`, 'Add 1 or 2 decoy pieces to "inventory" and keep "par" at the solution size. Run the check again: a decoy may open a shortcut.');
  point(total === 1 && counted !== 'partial', `exactly one layout wins (${total}${counted === 'partial' ? '+' : ''})`, 'Close the other par layouts (see the "other:" lines) with walls, sensors or exact amounts.');

  // Blind steps: with a greedy player who always takes the step that fills the rings most, how often does no step help?
  let blind = 0;
  {
    const doneSteps: SolutionStep[] = [];
    const rest = [...solution];
    const value = (steps: SolutionStep[]) => {
      try {
        const a = applySteps(level, steps);
        return looksGood(a.entities, a.t, a.ev, w, h);
      } catch {
        return -Infinity;
      }
    };
    let now = value([]);
    while (rest.length) {
      let bestI = 0;
      let bestV = -Infinity;
      rest.forEach((s, i) => {
        const v = value([...doneSteps, s]);
        if (v > bestV) {
          bestV = v;
          bestI = i;
        }
      });
      if (bestV <= now + 1e-6) blind++;
      now = bestV;
      doneSteps.push(rest.splice(bestI, 1)[0]);
    }
  }
  point(blind >= 1, `steps that neither fill a ring nor bring light nearer to one when made (${blind} of ${solution.length})`, 'Make one step pay off only later: send the light away from the rings first, or put a piece where its light is still blocked until another piece is placed.');

  const width = greedyWidth(level, par, [1, 3, 10, 30], ms);
  point(width !== 1 && width !== 3, width === null
    ? 'chasing fuller rings and nearer light does not find the solution, even when the 30 best-looking boards are kept at every step'
    : `chasing fuller rings and nearer light ${width === 1 ? 'finds the solution directly' : `finds the solution only when the ${width} best-looking boards are kept at every step`}`,
    'A player who always makes the move that fills the rings most solves it. Add a tempting route that almost works: a ring that the direct beam reaches with too little light, or a sensor on the direct route, so that the best-looking move is wrong.', width === null ? 2 : 1);

  const exact = solved.ev.targets.some((t) => {
    const e = solved.entities.find((x) => x.id === t.id)!;
    // A screen with a pixel that must stay dark, or must show one colour only, is spoiled by stray light like a strict ring.
    if (t.pixels) return t.pixels.some((p) => p.want.some((v) => v === 0));
    return t.kind === 'sink' && (e.params.strict === true || e.params.each === true || (e.params.pol !== undefined && e.params.pol !== null) || t.value < 1.15 * t.threshold) && t.threshold < 0.85;
  });
  point(exact, 'exact amounts or colours (a ring that is strict, mixed, polarized, or needs nearly all the light the solution brings)', 'Set a ring\'s "required" just below what the solution delivers (see `show --solve`), or make it "strict" so that extra colours spoil it.');
  point(solved.ev.targets.some((t) => t.kind === 'sensor') && par1.nearMisses > 0, `a sensor to avoid, and boards that look almost solved but are not (${par1.nearMisses} found)`, 'Put a sensor where the obvious route sends light (for example straight behind the first turn).');

  let forgiving = 0;
  for (const step of solution) {
    const type = step.type ?? level.entities.find((e) => e.id === step.id)?.type;
    if (!type) continue;
    for (const a of anglesFor(type, level.rotationStep ?? 15)) {
      if (a === step.angle % (getType(type).symmetry ?? 360)) continue;
      try {
        if (applySteps(level, solution.map((s) => (s === step ? { ...s, angle: a } : s))).ev.won) forgiving++;
      } catch {
        /* ignore */
      }
    }
  }
  out.push(`  (info) other angles of solution pieces that also win: ${forgiving}`);
  if (!proven) out.push('  (info) the shortcut search was a hunt, not a proof. Use --deep for a longer search.');
  barNotes = [];
  if (total !== 1) barNotes.push(`${total}${counted === 'partial' ? ' or more' : ''} layouts win, the bar is exactly 1`);
  else if (counted === 'partial') barNotes.push('the layout count is not finished: run the check with --deep');
  return done(Math.min(loose ? 2 : 8, score));
}
