#!/usr/bin/env node
/**
 * Level-design command line. See docs/LEVEL-DESIGN.md.
 *
 *   npm run level -- show  <id | file.json> [--solve] [--place type@x,y@angle]... [--turn id@angle]... [--move id@x,y]...
 *   npm run level -- check <id | file.json> [--deep]
 *   npm run level -- pieces <world>
 *   npm run level -- list
 *
 * The game code is TypeScript bundled by Vite, so it is loaded through Vite here.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, target, ...rest] = process.argv.slice(2);
const flags = { place: [], turn: [], move: [] };
for (let i = 0; i < rest.length; i++) {
  const name = rest[i].replace(/^--/, '');
  if (name in flags) flags[name].push(rest[++i]);
  else flags[name] = true;
}

const usage = `Usage:
  npm run level -- show  <id | file.json> [--solve] [--place type@x,y@angle]... [--turn id@angle]... [--move id@x,y]...
  npm run level -- check <id | file.json> [--deep]
  npm run level -- pieces <world>      which pieces a world's levels may and must use
  npm run level -- list                worlds and their levels
Examples:
  npm run level -- show fork --solve
  npm run level -- show src/levels/mirror/my-level.json --place mirror@3,4@45 --place "filter:color=red@5,4@0"
  npm run level -- check src/levels/mirror/my-level.json`;

if (!cmd || cmd === 'help' || (cmd !== 'list' && !target)) {
  console.log(usage);
  process.exit(cmd ? 0 : 1);
}

const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, ws: false, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
let code = 0;
try {
  const { LEVELS, WORLDS } = await server.ssrLoadModule('/src/levels/index.ts');
  const design = await server.ssrLoadModule('/src/level/design.ts');
  const { ancestors, featuredPieces } = await server.ssrLoadModule('/src/level/worlds.ts');

  const load = () => {
    if (target.endsWith('.json')) {
      const file = resolve(process.cwd(), target);
      let raw;
      try {
        raw = JSON.parse(readFileSync(file, 'utf8'));
      } catch (e) {
        throw new Error(`Cannot read ${target}: ${e.message}`);
      }
      if (raw.id && raw.id !== basename(file, '.json')) throw new Error(`The file is called ${basename(file)} but its "id" is "${raw.id}". They must match.`);
      const inPack = dirname(file).startsWith(resolve(root, 'src/levels'));
      return { raw, world: inPack ? basename(dirname(file)) : undefined, taken: LEVELS.map((l) => l.id).filter((id) => id !== raw.id) };
    }
    const level = LEVELS.find((l) => l.id === target);
    if (!level) throw new Error(`No level with id "${target}". Give an id from \`npm run level -- list\` or a path ending in .json.`);
    return { raw: level, world: WORLDS.find((w) => w.levels.includes(target))?.id, taken: [] };
  };

  if (cmd === 'list') {
    for (const w of WORLDS) console.log(`${w.id}  (new piece: ${w.object ?? 'none, combines ' + w.parents.join(' + ')})\n    ${w.levels.join(', ')}`);
  } else if (cmd === 'pieces') {
    const w = WORLDS.find((x) => x.id === target);
    if (!w) throw new Error(`No world "${target}". Worlds: ${WORLDS.map((x) => x.id).join(', ')}`);
    const known = new Set(WORLDS.filter((x) => ancestors(WORLDS, w.id).has(x.id)).map((x) => x.object).filter(Boolean));
    if (w.object) known.add(w.object);
    console.log(`World ${w.id}: every level MUST use ${featuredPieces(WORLDS, w).join(' and ')}.\nIt MAY also use: ${[...known].join(', ')}.\nA divergingLens is {"type":"lens","params":{"f":-2}}. Lasers, bulbs, sun, rings, sensors, walls, slits, solar cells and gates are allowed everywhere.`);
  } else if (cmd === 'show') {
    const { raw } = load();
    const { parseLevel } = await server.ssrLoadModule('/src/level/validate.ts');
    console.log(design.describe(parseLevel(raw), { solve: !!flags.solve, place: flags.place, turn: flags.turn, move: flags.move }));
  } else if (cmd === 'check') {
    const { raw, world, taken } = load();
    const r = design.check(raw, { world, worlds: WORLDS, takenIds: taken, ms: flags.deep ? 120000 : 15000 });
    console.log(r.text);
    if (r.ok && world && !WORLDS.some((w) => w.levels.includes(raw.id))) console.log(`\nNext: add "${raw.id}" to the "levels" list of world "${world}" in src/levels/worlds.json (ordered easy to hard), then run \`npm test\`.`);
    code = r.ok ? 0 : 2;
  } else {
    console.log(usage);
    code = 1;
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  code = 1;
} finally {
  await server.close();
}
process.exit(code);
