# Writing levels

Levels live in one folder per world, `src/levels/<world>/<id>.json`. Their order and the world tree are defined in `src/levels/worlds.json`:

```json
{ "id": "splitter", "map": [1.9, 0.3], "name": { "en": "Forks", "de": "Gabelungen" }, "object": "splitter", "parents": ["mirror"], "levels": ["half-and-half", "fork", "…"] }
```

The rules, all enforced by `npm test`:

- **One new piece per world.** `object` is the piece the world introduces (`mirror`, `splitter`, `lens`, `divergingLens`, `curvedMirror`, `block`, `filter`, `prism`, `polarizer`, `blackHole`, `grating`, `polCube`). A world may have several `parents`; it opens when each of them has 4 solved levels and can use all of their pieces. Every level in the world uses it, and may otherwise only use pieces introduced by the world's ancestors. Sources, targets, sensors, walls, slits, photocells and gates are level features and can be used anywhere.
- **Combining worlds.** A world with two or more `parents` may leave out `object`. It introduces nothing and combines its parents' pieces instead: every level uses each parent's piece (in the tray or pre-placed), and may use anything from the ancestors. *Kaleidoscope* (polarizer + grating) is one. Keep these worlds hard; they are for players who know both pieces well.
- **A place on the star map.** `map` is `[x, y]` in map units, `x` to the right and `y` down. A world sits below all of its parents, at least 0.95 away from every other world in `x` or in `y`, and no line between two worlds may run through a third.
- **At least 6 levels per world**, ordered from easy to hard.
- Every level file is listed by exactly one world.

The test suite checks every level automatically.

```json
{
  "schema": 1,
  "id": "fork",
  "name": { "en": "A Fork in the Beam", "de": "Gabelung" },
  "intro": { "en": "…", "de": "…" },
  "grid": { "w": 10, "h": 7 },
  "par": 3,
  "entities": [
    { "type": "laser", "x": 0, "y": 3, "angle": 0 },
    { "type": "sink", "x": 8, "y": 0, "params": { "required": 0.45 } },
    { "id": "m1", "type": "mirror", "x": 3, "y": 3, "angle": 90, "lock": "rotate" },
    { "type": "wall", "x": 6, "y": 1, "params": { "w": 1, "h": 1 } }
  ],
  "inventory": [{ "type": "splitter", "count": 1 }, { "type": "mirror", "count": 2 }],
  "solution": [
    { "type": "splitter", "x": 2, "y": 3, "angle": 45 },
    { "id": "m1", "x": 3, "y": 3, "angle": 45 }
  ]
}
```

## Coordinates and angles

- `x`, `y` are grid cells: `x` to the right, `y` **down**. A piece sits at the centre of its cell.
- `angle` is in degrees, with 0° = right and 90° = down. For sources it is the beam direction. For thin optics it is the direction the surface **faces** (its normal). For example, a mirror at 135° turns a rightward beam downward.
- Players rotate in `rotationStep` increments (default 15°).

## Entity types and parameters

| type | params (defaults) |
| --- | --- |
| `laser` | `color` (`white`), `power` (1), `pol` (null = unpolarized, or an axis in degrees) |
| `bulb` | `color`, `power` (1), `rays` (720) |
| `sun` | `color`, `power` (1), `width` (3 cells), `rays` (90) |
| `sink` | `required` (0.9), `color` (`white`, i.e. accepts all), `strict` (false: off-colour light spoils it), `each` (false: every colour of `color` must bring an equal share, for mixing), `pol` (null, or an axis in degrees: only light polarized along it counts; with `strict` other light spoils it), `radius` (0.32) |
| `sensor` | `limit` (0.02): more light than this blocks the win |
| `mirror` | `reflectance` (1) |
| `splitter` | `ratio` (0.5) |
| `filter` | `color` (`red`) |
| `lens` | `f` (2 cells; negative = diverging) |
| `curvedMirror` | `f` (1.5); its back absorbs |
| `prism` | `n` per channel ([1.38, 1.5, 1.64]), `radius` (0.46) |
| `block` | `n` (1.5), `size` (0.8) |
| `polarizer` | none: a disc whose axis is its `angle` (mod 180°). Unpolarized light loses half its power, polarized light keeps cos²(angle difference) (Malus's law); either way it leaves polarized along the axis |
| `blackHole` | `rs` (0.2): Schwarzschild radius in cells; light passing at distance b turns by 2·rs/b towards it (more on close passes), and light coming within 2.6·rs (its shadow) is swallowed. `reach` (2): its pull is ignored further away. It can't be rotated |
| `photocell` | `required` (0.1): powered once it receives this much light |
| `gate` | `w`, `h` like a wall, `by`: a photocell id (or a list of ids). It opens while all of them are powered; a gate can't hold itself open with light that only gets through once it is open |
| `grating` | `spacing` (1000): line spacing in nanometres. A third of the light goes straight on (all colours), a third to each side, where each colour turns by the grating equation sin θ = sin θᵢ ± λ/spacing (red 650 nm, green 530 nm, blue 450 nm). A side beam that can't exist gives its share to the straight beam. So a white laser gives side beams of 1/9 per colour |
| `polCube` | none: a polarizing beam splitter cube. Its coating faces `angle` like a mirror. Light polarized at 0° passes straight through, light polarized at 90° is mirrored; other light divides by Malus's law (cos² through, sin² mirrored), unpolarized light half and half. Both beams leave polarized and nothing is lost. Which polarization passes does not depend on how the cube is turned |
| `blocker` | `size` (0.56) |
| `wall` | `w`, `h` in cells (anchored at the top-left cell) |
| `slit` | `gap` (0.2), `offset` (0): a one-cell barrier facing `angle` with an opening of `gap` cells, shifted sideways by `offset` |

Colours can be names (`white`, `red`, `green`, `blue`, `yellow`, `cyan`, `magenta`) or `[r, g, b]` masks. Power is split across channels, so a white laser of power 1 carries 1/3 in each of red, green and blue.

## Lock modes

- `fixed` (default): cannot be touched.
- `rotate`: stays put but can be turned.
- `free`: can be moved and turned, but is not returned to the tray.

## Checklist

1. Give the level a reference `solution`. Steps with `type` place tray pieces; steps with `id` turn pre-placed ones. The `intro` text is the first hint (free, it doesn't cost a star); after it, hints reveal the solution one step at a time. Set `"introOnStart": true` only for tutorial levels whose text explains the controls.
2. Run `npm test`. It checks that the level is unsolved at the start, that the solution wins with 3 stars, and that multi-piece levels can't be solved with a single piece.
3. Use `npm run level -- show <id> --solve` for a text picture of the board with its light, or `npm run dev` and open `#/level/<id>` (add `?solve` to see the solution) to check that it looks right.
4. Black holes act at a distance, so the solver also tries them next to lit cells. Levels with sunlight or bulbs plus black holes trace slowly; keep their trays small.
5. If sinks need different amounts, players see it: each ring's band is drawn as thick as its `required`, relative to the largest one on the board.
6. For diffuse sources (bulbs), choose `required` values from experiment. The solver API (`src/level/solver.ts`) helps there: rings show progress relative to `required`.
7. Run `npm run level -- check <id or file>` to see whether the level has a shortcut, how many solutions it has and how hard it is. [LEVEL-DESIGN.md](LEVEL-DESIGN.md) is a step-by-step procedure built on these commands.

## The solver, the hunt and the level report

The solver (`src/level/solver.ts`) is exhaustive: it tries tray pieces wherever the light goes, turns `rotate` pieces once light reaches them and moves `free` pieces. It visits each set of placements once and drops placements the light doesn't touch. The cost still grows about 300-fold per tray piece, so it proves things for up to about 3 tray pieces within a minute. Pieces that can only be turned are cheap.

For bigger trays there is the **hunt** (`solve(level, { hunt: true })`). Of the placements of one piece that leave the same light on the board (a filter at another angle, a polarizer one cell further along its beam) it follows only the first, and it tries the placements that fill the rings most first. Every solution it reports is real. It can miss a solution in which such a piece has to stand in one particular cell because another beam crosses the alternatives, so "none found" is strong evidence and not proof.

`npm run report` runs both on every laser level (or the ones in `REPORT_LEVELS=a,b`; `REPORT_DIFFUSE=1` adds bulbs and sunlight) and prints how many par solutions each has, how many different layouts they are, the fewest pieces any solution needs, and how many boards a progress-chasing search tries before it finds a solution. Two solutions are the same layout when the light travels along the same lines. It flags:

- **BEATS-PAR**: a solution needs fewer pieces than par, so the level is easier than intended (and some tray piece is never needed).
- **LOOSE**: 10 or more layouts, so almost any reasonable try works.
- **HUNT**: the exact search ran out of budget and the hunt was used.
- **PARTIAL / UNSOLVED**: the search budget ran out (raise it with `REPORT_NODES`), so the counts are lower bounds.

Early levels in a world can be loose. For the later ones, aim for one to three layouts.

## Making levels challenging

A level gets harder when the first idea a player has almost works, not when the board gets bigger. [LEVEL-DESIGN.md](LEVEL-DESIGN.md) has the full list of what makes a level hard and a procedure for building one. Some techniques that work with the existing pieces:

- **Decoys and a tight par.** Put pieces in the tray that the 3-star solution doesn't use, and set `par`. The obvious route then wins with 2 stars, and the win card tells players that fewer pieces are enough (`colour-keys`, `purple-rain`).
- **A piece used in an unexpected way.** A grating turned steeply loses one rainbow, and that light goes into the straight beam (`white-stays-white`). Light can go back through a prism a second time (`purple-rain`). Other examples: a single-colour laser through a prism or grating as a mirror at an odd angle, or a black hole that swings a beam right round.
- **Exact amounts.** Choose `required` so that only one way of splitting the light reaches it (½, ¼, ⅑, cos²), and use `each` and `strict` so that nearly right fails.
- **Pre-placed pieces as misdirection.** Use `rotate` pieces that start at a tempting angle, and `free` pieces that have to be moved.
- **Narrow approaches.** Put photocells and rings in niches between walls, so that only one beam direction reaches them. This cuts the number of solutions more than extra walls in open space.
