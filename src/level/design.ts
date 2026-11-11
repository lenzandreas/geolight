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
import { anglesFor, litCells, progressOf, solve } from './solver';
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
    if (s.pieceAt(x, y)) throw new Error(`--place ${m}: cell ${x},${y} is taken by ${s.pieceAt(x, y)!.type}`);
    if (!s.place(slotKey(type, params), x, y, Number(angle))) {
      notes.push(`${spec} is not in the tray (or the tray has run out); placed it anyway`);
      entities.push({ id: `x${extra++}`, type, x, y, angle: Number(angle), params });
    }
  }
  return { entities, notes, placed: s.placedCount + extra };
}

/* ---------- Text picture ---------- */

const CODES: Record<string, string> = {
  bulb: 'Bu', sun: 'Su', wall: '##', slit: '][', photocell: 'Pc', mirror: 'Mi', splitter: 'Sp', curvedMirror: 'Cm', filter: 'Fi',
  prism: 'Pr', block: 'Gl', polarizer: 'Po', blackHole: '@@', grating: 'Gr', blocker: 'Bl',
};
const LEGEND: Record<string, string> = {
  'L>': 'laser (arrow = beam direction; L* = slanted)', Bu: 'bulb', Su: 'sunlight', 'O ': 'ring, not full', 'O*': 'ring, full', '! ': 'sensor, dark',
  '!X': 'sensor, TRIPPED', '##': 'wall', '[]': 'gate, shut', '[ ': 'gate, open', '][': 'slit', Pc: 'solar cell', Mi: 'mirror', Sp: 'splitter', Le: 'lens',
  Ld: 'diverging lens', Cm: 'concave mirror', Fi: 'filter', Pr: 'prism', Gl: 'glass block', Po: 'polarizer', '@@': 'black hole', Gr: 'grating', Bl: 'shade',
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
    if (s.kind === 'sink') {
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
  const { t } = applySteps(level, steps);
  const q = (v: number, m: number) => Math.round(v * m);
  const lines = new Set<string>();
  for (const s of t.segments) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // Distance of the line from the origin; together with the heading it names the line whatever piece cuts it.
    const offset = (s.a.x * dy - s.a.y * dx) / len;
    lines.add(`${q((Math.atan2(dy, dx) * 180) / Math.PI, 2)},${q(offset, 50)},${q(s.c[0], 200)},${q(s.c[1], 200)},${q(s.c[2], 200)},${s.pol === null ? '' : q(s.pol, 1)}`);
  }
  return [...lines].sort().join(';');
}

export function check(raw: unknown, opts: CheckOptions = {}): CheckResult {
  const out: string[] = [];
  const errors: string[] = [];
  const advice: string[] = [];
  const done = (score = 0): CheckResult => {
    out.push('');
    if (errors.length) {
      out.push(`VERDICT: FAIL. Fix these ${errors.length} problem(s), then run the check again:`);
      errors.forEach((e, i) => out.push(`  ${i + 1}. ${e}`));
    } else out.push(`VERDICT: PASS, challenge ${score}/8 (${score >= 5 ? 'challenging' : score >= 3 ? 'medium' : 'gentle'}).`);
    if (advice.length) {
      out.push('', errors.length ? 'How to fix:' : 'To make it harder (most important first):');
      advice.forEach((a) => out.push(`  - ${a}`));
    }
    return { ok: !errors.length, score, text: out.join('\n') };
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
  if (!level.entities.some((e) => e.type === 'sink')) errors.push('there is no ring (sink)');
  for (const item of level.inventory) if (!pieceKind(item.type, item.params)) errors.push(`${item.type} cannot be a tray piece`);
  if (opts.world && opts.worlds) {
    const world = opts.worlds.find((x) => x.id === opts.world);
    if (!world) errors.push(`the folder "${opts.world}" is not a world in src/levels/worlds.json`);
    else {
      const known = new Set(opts.worlds.filter((x) => ancestors(opts.worlds!, world.id).has(x.id)).map((x) => x.object));
      if (world.object) known.add(world.object);
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
  if (!shortcut) out.push(`Par solutions: ${total}${counted === 'partial' ? ' or more (search ran out of time)' : counted === 'hunt' ? ' (hunt)' : ''} different layout(s), the reference one included. Placements that leave the same light (a piece slid along its beam) count once.`);
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
  point(par >= 3 || solution.filter((s) => s.id).length >= 3, `needs 3 or more moves (par ${par}, ${solution.filter((s) => s.id).length} piece(s) to turn)`, 'Add a step: a second ring, a pre-placed piece with lock "rotate" at a wrong angle, or a wall that forces one more turn.');
  point(trayCount > par, `decoys in the tray (${trayCount - par})`, 'Add 1 or 2 decoy pieces to "inventory" and keep "par" at the solution size. Run the check again: a decoy may open a shortcut.');
  point(total === 1 && counted !== 'partial', `exactly one layout wins (${total}${counted === 'partial' ? '+' : ''})`, 'Close the other par layouts (see the "other:" lines) with walls, sensors or exact amounts.');

  // Blind steps: with a greedy player who always takes the step that fills the rings most, how often does no step help?
  let blind = 0;
  {
    const doneSteps: SolutionStep[] = [];
    const rest = [...solution];
    const value = (steps: SolutionStep[]) => {
      try {
        return progressOf(applySteps(level, steps).ev);
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
  point(blind >= 1, `steps that show no progress when made (${blind} of ${solution.length})`, 'Make one step pay off only later: send the light away from the rings first, or put a piece where its light is still blocked until another piece is placed.');

  const guided = solve(level, { maxPieces: par, maxSolutions: 1, maxNodes: Infinity, maxMs: ms, hunt: true });
  const effort = guided.solutions.length ? guided.nodes : Infinity;
  point(effort >= 3000, `following the brightest rings does not lead to the solution quickly (guided search needed ${effort === Infinity ? 'more than the time limit' : effort + ' boards'})`, 'The solution is found by simply chasing progress. Add a tempting route that almost works: a ring that the direct beam reaches with too little light, or a sensor on the direct route.', effort >= 30000 ? 2 : 1);

  const exact = solved.ev.targets.some((t) => {
    const e = solved.entities.find((x) => x.id === t.id)!;
    return t.kind === 'sink' && (e.params.strict === true || e.params.each === true || (e.params.pol !== undefined && e.params.pol !== null) || t.value < 1.15 * t.threshold) && t.threshold < 0.85;
  });
  point(exact, 'exact amounts or colours (a ring that is strict, mixed, polarized, or needs nearly all the light the solution brings)', 'Set a ring\'s "required" just below what the solution delivers (see `show --solve`), or make it "strict" so that extra colours spoil it.');
  point(solved.ev.targets.some((t) => t.kind === 'sensor') && par1.nearMisses + guided.nearMisses > 0, `a sensor to avoid, and dead ends that look almost solved (${par1.nearMisses + guided.nearMisses})`, 'Put a sensor where the obvious route sends light (for example straight behind the first turn).');

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
  return done(Math.min(loose ? 2 : 8, score));
}
