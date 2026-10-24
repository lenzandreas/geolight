/**
 * Daily puzzle: a level generated from the date, identical for every player.
 *
 * The generator walks a laser path with right-angle turns, puts a mirror at each
 * turn and a sink at the end, then hides the mirrors in the tray (or bolts some
 * down at a wrong angle) and decorates the board. Each candidate is checked:
 * unsolved at the start, solved by its own path, and not solvable with a single
 * piece. Difficulty grows over the week.
 */
import { Session } from '../game/session';
import type { EntityDef, InventoryItem, LevelDef, SolutionStep } from './schema';
import { solve } from './solver';

/** Local calendar date as YYYY-MM-DD. */
export function dailyKey(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dailyId(key: string): string {
  return `daily-${key}`;
}

/** The previous calendar day's key. */
export function previousKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dailyKey(new Date(y, m - 1, d - 1));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Small, fast, seedable PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const angleOf = ([dx, dy]: [number, number]) => ((Math.round((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + 360) % 360;

export interface DailyConfig {
  turns: number;
  w: number;
  h: number;
  sensor: boolean;
  splitter: boolean;
  bolted: number;
  decoys: number;
  walls: number;
}

/** Monday is gentle, the weekend is tricky. */
export function configFor(key: string, random: () => number): DailyConfig {
  const [y, m, d] = key.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = Monday
  const tier = dow < 2 ? 0 : dow < 5 ? 1 : 2;
  return {
    turns: [2, 3, 4][tier],
    w: [9, 10, 11][tier],
    h: [6, 7, 8][tier],
    sensor: tier > 0 && random() < 0.6,
    splitter: tier > 0 && random() < 0.4,
    bolted: tier === 0 ? 0 : Math.floor(random() * (tier + 1)),
    decoys: tier === 2 && random() < 0.5 ? 1 : 0,
    walls: 3 + Math.floor(random() * (3 + tier * 2)),
  };
}

interface Candidate {
  entities: EntityDef[];
  inventory: InventoryItem[];
  solution: SolutionStep[];
}

function attempt(cfg: DailyConfig, random: () => number): Candidate | null {
  const { w, h } = cfg;
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const key = (x: number, y: number) => y * w + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const used = new Set<number>();

  // Laser on an edge, pointing inwards.
  let dir = DIRS[int(0, 3)];
  let x = dir[0] === 1 ? 0 : dir[0] === -1 ? w - 1 : int(1, w - 2);
  let y = dir[1] === 1 ? 0 : dir[1] === -1 ? h - 1 : int(1, h - 2);
  const entities: EntityDef[] = [{ type: 'laser', x, y, angle: angleOf(dir) }];
  used.add(key(x, y));

  /** Walk n free cells; false if blocked. */
  const walk = (n: number): boolean => {
    for (let i = 0; i < n; i++) {
      x += dir[0];
      y += dir[1];
      if (!inside(x, y) || used.has(key(x, y))) return false;
      used.add(key(x, y));
    }
    return true;
  };

  const turns: { x: number; y: number; angle: number; inDir: [number, number] }[] = [];
  for (let k = 0; k < cfg.turns; k++) {
    if (!walk(int(2, 4))) return null;
    const turn = random() < 0.5 ? 1 : 3;
    const next = DIRS[(DIRS.indexOf(dir) + turn) % 4];
    // Mirror normal bisects the turn: along (new − old).
    turns.push({ x, y, angle: angleOf([next[0] - dir[0], next[1] - dir[1]] as [number, number]) % 180, inDir: dir });
    dir = next;
  }
  if (!walk(int(2, 4))) return null;
  const sinkRequired = cfg.splitter ? 0.45 : 0.9;
  entities.push({ type: 'sink', x, y, params: { required: sinkRequired } });

  // Splitter: one turn lets half the light straight through to a second sink.
  let splitAt = -1;
  if (cfg.splitter) {
    splitAt = int(0, turns.length - 2);
    const t = turns[splitAt];
    let sx = t.x;
    let sy = t.y;
    const n = int(2, 3);
    for (let i = 0; i < n; i++) {
      sx += t.inDir[0];
      sy += t.inDir[1];
      if (!inside(sx, sy) || used.has(key(sx, sy))) return null;
      used.add(key(sx, sy));
    }
    entities.push({ type: 'sink', x: sx, y: sy, params: { required: 0.45 } });
  }

  // Sensor right behind the first turn: skipping the corner wakes it.
  if (cfg.sensor) {
    const t = turns[0];
    const sx = t.x + t.inDir[0];
    const sy = t.y + t.inDir[1];
    if (inside(sx, sy) && !used.has(key(sx, sy)) && splitAt !== 0) {
      entities.push({ type: 'sensor', x: sx, y: sy });
      used.add(key(sx, sy));
    }
  }

  // Bolted mirrors: placed but turned wrong; the rest go to the tray.
  const solution: SolutionStep[] = [];
  let trayMirrors = 0;
  const bolted = new Set<number>();
  while (bolted.size < Math.min(cfg.bolted, turns.length - 1)) bolted.add(int(0, turns.length - 1));
  turns.forEach((t, i) => {
    if (i === splitAt) {
      solution.push({ type: 'splitter', x: t.x, y: t.y, angle: t.angle });
    } else if (bolted.has(i)) {
      const id = `m${i}`;
      entities.push({ id, type: 'mirror', x: t.x, y: t.y, angle: (t.angle + 15 * int(1, 11)) % 180, lock: 'rotate' });
      solution.push({ id, x: t.x, y: t.y, angle: t.angle });
    } else {
      trayMirrors++;
      solution.push({ type: 'mirror', x: t.x, y: t.y, angle: t.angle });
    }
  });

  // Walls on free cells.
  for (let i = 0, tries = 0; i < cfg.walls && tries < 60; tries++) {
    const wx = int(0, w - 1);
    const wy = int(0, h - 1);
    const long = random() < 0.4;
    const ww = long && random() < 0.5 ? 2 : 1;
    const wh = long && ww === 1 ? 2 : 1;
    const cells: number[] = [];
    for (let a = 0; a < ww; a++) for (let b = 0; b < wh; b++) if (inside(wx + a, wy + b)) cells.push(key(wx + a, wy + b));
    if (cells.length !== ww * wh || cells.some((c) => used.has(c))) continue;
    cells.forEach((c) => used.add(c));
    entities.push({ type: 'wall', x: wx, y: wy, params: { w: ww, h: wh } });
    i++;
  }

  const inventory: InventoryItem[] = [];
  if (trayMirrors + cfg.decoys > 0) inventory.push({ type: 'mirror', count: trayMirrors + cfg.decoys });
  if (splitAt >= 0) inventory.push({ type: 'splitter', count: 1 });
  return { entities, inventory, solution };
}

const cache = new Map<string, LevelDef>();

export function generateDaily(key: string): LevelDef {
  const hit = cache.get(key);
  if (hit) return hit;
  const random = rng(hash(`geolight:${key}`));
  const cfg = configFor(key, random);
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const fmt = (lang: string) => date.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
  for (let i = 0; i < 400; i++) {
    const c = attempt(cfg, random);
    if (!c) continue;
    const level: LevelDef = {
      schema: 1,
      id: dailyId(key),
      world: 0,
      name: { en: fmt('en-GB'), de: fmt('de-DE') },
      grid: { w: cfg.w, h: cfg.h },
      entities: c.entities,
      inventory: c.inventory,
      solution: c.solution,
    };
    if (isGoodPuzzle(level)) {
      cache.set(key, level);
      return level;
    }
  }
  throw new Error(`No daily puzzle for ${key}`);
}

function isGoodPuzzle(level: LevelDef): boolean {
  if (new Session(level).won) return false;
  const solved = new Session(level);
  try {
    solved.applySolution();
  } catch {
    return false;
  }
  if (!solved.won) return false;
  // Reject puzzles with a one-piece shortcut (bounded search keeps generation fast).
  const shortcut = solve(level, { maxPieces: 1, maxSolutions: 1, maxNodes: 3000 });
  return shortcut.solutions.length === 0;
}
