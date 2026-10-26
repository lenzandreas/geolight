/**
 * Level report: how loose is each level? Runs the solver on every level and
 * prints how many perfect (par) solutions it has, how few pieces any solution
 * needs and how long the search took to find one. Solutions with spare pieces
 * (for example using decoys from the tray) are not counted: they only earn 2 stars. Run it with `npm run report`.
 *
 * Environment variables:
 *   REPORT_LEVELS  comma-separated level ids (default: all)
 *   REPORT_NODES   search budget per level (default 150000 traces)
 *   REPORT_MAX     stop counting solutions at this many (default 50)
 *   REPORT_DIFFUSE 1 = also search levels with bulbs or sunlight (slow)
 *
 * Flags:
 *   BEATS-PAR  a solution uses fewer tray pieces than par: the level is easier than intended
 *              ("fewest" is the smallest such count; otherwise par, once any solution is found)
 *   LOOSE      many par layouts (≥ 10): almost any reasonable try works. A layout is where the
 *              pieces go, ignoring their angles: turning a filter or using a polarizer's
 *              other diagonal is not a different idea
 *   PARTIAL    the budget ran out, so the counts are lower bounds
 *   UNSOLVED   no solution found within the budget (the reference solution is checked by the tests)
 */
import { test } from 'vitest';
import { solve } from '../src/level/solver';
import { Session } from '../src/game/session';
import { LEVELS, WORLDS } from '../src/levels';

// The project has no Node type definitions; the report only needs the environment.
declare const process: { env: Record<string, string | undefined> };
const env = process.env;
const only = env.REPORT_LEVELS ? new Set(env.REPORT_LEVELS.split(',')) : null;
const maxNodes = Number(env.REPORT_NODES ?? 150000);
const maxSolutions = Number(env.REPORT_MAX ?? 50);
const LOOSE = 10;

test('level report', () => {
  const worldOf = new Map(WORLDS.flatMap((w) => w.levels.map((id) => [id, w.id] as const)));
  const rows: string[][] = [['world', 'level', 'par', 'tray', 'par solutions', 'layouts', 'fewest', 'first at', 'flags']];
  for (const level of LEVELS) {
    if (only && !only.has(level.id)) continue;
    const par = new Session(level).par;
    const tray = level.inventory.reduce((n, i) => n + i.count, 0);
    const diffuse = level.entities.some((e) => e.type === 'bulb' || e.type === 'sun');
    if (diffuse && env.REPORT_DIFFUSE !== '1') {
      rows.push([worldOf.get(level.id) ?? '', level.id, String(par), String(tray), '–', '–', '–', '–', 'skipped (diffuse light)']);
      continue;
    }
    // A separate search for the first solution: how many traces until the solver finds one.
    const first = solve(level, { maxSolutions: 1, maxNodes, maxPieces: par });
    const all = solve(level, { maxSolutions, maxNodes, maxPieces: par });
    // The capped depth-first search can miss shorter solutions, so look for those separately, smallest first.
    let fewest: number | null = all.solutions.length ? par : null;
    for (let k = 0; k < par; k++) {
      if (solve(level, { maxPieces: k, maxSolutions: 1, maxNodes }).solutions.length) {
        fewest = k;
        break;
      }
    }
    const layouts = new Set(all.solutions.map((s) => s.map((step) => `${step.id ?? step.type}@${step.x},${step.y}`).sort().join('|'))).size;
    const flags: string[] = [];
    if (fewest !== null && fewest < par) flags.push('BEATS-PAR');
    if (layouts >= LOOSE) flags.push('LOOSE');
    if (!all.exhausted && all.solutions.length < maxSolutions) flags.push('PARTIAL');
    if (!all.solutions.length) flags.push('UNSOLVED');
    rows.push([
      worldOf.get(level.id) ?? '',
      level.id,
      String(par),
      tray > par ? `${tray} (+${tray - par})` : String(tray),
      `${all.solutions.length}${all.solutions.length >= maxSolutions || !all.exhausted ? '+' : ''}`,
      String(layouts),
      fewest === null ? '–' : String(fewest),
      first.solutions.length ? String(first.nodes) : '–',
      flags.join(' '),
    ]);
  }
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  console.log('\n' + rows.map((r) => r.map((cell, c) => cell.padEnd(widths[c])).join('  ').trimEnd()).join('\n') + '\n');
});
