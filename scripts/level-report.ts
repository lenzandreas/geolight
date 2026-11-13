/**
 * Level report: how loose is each level? Runs the solver on every level and
 * prints how many perfect (par) solutions it has, how few pieces any solution
 * needs and how long the search took to find one. Solutions with spare pieces
 * (for example using decoys from the tray) are not counted: they only earn 2 stars. Run it with `npm run report`.
 *
 * Environment variables:
 *   REPORT_LEVELS  comma-separated level ids (default: all)
 *   REPORT_NODES   search budget per level (default 400000 traces)
 *   REPORT_MAX     stop counting solutions at this many (default 50)
 *   REPORT_DIFFUSE 1 = also search levels with bulbs or sunlight (slow)
 *
 * Flags:
 *   BEATS-PAR  a solution uses fewer tray pieces than par: the level is easier than intended
 *              ("fewest" is the smallest such count; otherwise par, once any solution is found)
 *   LOOSE      many par layouts (≥ 10): almost any reasonable try works. Two solutions are the
 *              same layout when the light travels along the same lines: sliding a filter along
 *              its beam or turning it a little is not a different idea
 *   PARTIAL    the budget ran out, so the counts are lower bounds
 *   HUNT       too big for the exact search within the budget: the approximate hunt was used, so
 *              "no shorter solution" is strong evidence and not proof
 *   UNSOLVED   no solution found within the budget (the reference solution is checked by the tests)
 */
import { test } from 'vitest';
import { ideaKey } from '../src/level/design';
import { solve } from '../src/level/solver';
import { Session } from '../src/game/session';
import { LEVELS, WORLDS } from '../src/levels';

// The project has no Node type definitions; the report only needs the environment.
declare const process: { env: Record<string, string | undefined> };
const env = process.env;
const only = env.REPORT_LEVELS ? new Set(env.REPORT_LEVELS.split(',')) : null;
const maxNodes = Number(env.REPORT_NODES ?? 400000);
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
    // How many boards a search that chases progress tries before it finds a solution: a measure of how misleading the level is.
    const first = solve(level, { maxSolutions: 1, maxNodes, maxPieces: par, hunt: true });
    let all = solve(level, { maxSolutions, maxNodes, maxPieces: par });
    let hunted = false;
    if (!all.exhausted && all.solutions.length < maxSolutions) {
      // Too big for the exact search: the hunt reaches deeper but counts near-identical placements once.
      const h = solve(level, { maxSolutions, maxNodes, maxPieces: par, hunt: true });
      if (h.solutions.length >= all.solutions.length) {
        all = h;
        hunted = true;
      }
    }
    // Shorter solutions, smallest first: exact where the budget allows, otherwise the hunt.
    let fewest: number | null = all.solutions.length ? par : null;
    let proven = true;
    for (let k = 0; k < par; k++) {
      let r = solve(level, { maxPieces: k, maxSolutions: 1, maxNodes });
      if (!r.solutions.length && !r.exhausted) {
        r = solve(level, { maxPieces: k, maxSolutions: 1, maxNodes, hunt: true });
        proven = false;
      }
      if (r.solutions.length) {
        fewest = k;
        break;
      }
    }
    const layouts = new Set(all.solutions.map((x) => ideaKey(level, x))).size;
    const flags: string[] = [];
    if (fewest !== null && fewest < par) flags.push('BEATS-PAR');
    if (layouts >= LOOSE) flags.push('LOOSE');
    if (!all.exhausted && all.solutions.length < maxSolutions) flags.push('PARTIAL');
    if (hunted || !proven) flags.push('HUNT');
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
