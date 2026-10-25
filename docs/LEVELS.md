# Writing levels

Levels live in one folder per world, `src/levels/<world>/<id>.json`. Their order and the world tree are defined in `src/levels/worlds.json`:

```json
{ "id": "splitter", "name": { "en": "Forks", "de": "Gabelungen" }, "object": "splitter", "parents": ["mirror"], "levels": ["half-and-half", "fork", "…"] }
```

The rules, all enforced by `npm test`:

- **One new piece per world.** `object` is the piece the world introduces (`mirror`, `splitter`, `lens`, `divergingLens`, `curvedMirror`, `block`, `filter`, `prism`, `polarizer`). A world may have several `parents`; it opens when each of them has 4 solved levels and can use all of their pieces. Every level in the world uses it, and may otherwise only use pieces introduced by the world's ancestors. Sources, targets, sensors, walls and slits are level features and can be used anywhere.
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
| `blocker` | `size` (0.56) |
| `wall` | `w`, `h` in cells (anchored at the top-left cell) |
| `slit` | `gap` (0.2), `offset` (0): a one-cell barrier facing `angle` with an opening of `gap` cells, shifted sideways by `offset` |

Colours can be names (`white`, `red`, `green`, `blue`, `yellow`, `cyan`, `magenta`) or `[r, g, b]` masks. Power is split across channels, so a white laser of power 1 carries 1/3 in each of red, green and blue.

## Lock modes

- `fixed` (default): cannot be touched.
- `rotate`: stays put but can be turned.
- `free`: can be moved and turned, but is not returned to the tray.

## Checklist

1. Give the level a reference `solution`. Steps with `type` place tray pieces; steps with `id` turn pre-placed ones. Hints reveal it one step at a time.
2. Run `npm test`. It checks that the level is unsolved at the start, that the solution wins with 3 stars, and that multi-piece levels can't be solved with a single piece.
3. Use `npm run dev` and open `#/level/<id>` (add `?solve` to see the solution) to check that it looks right.
4. If sinks need different amounts, players see it: each ring's track is drawn in proportion to the largest `required` on the board.
5. For diffuse sources (bulbs), choose `required` values from experiment. The solver API (`src/level/solver.ts`) helps there: rings show progress relative to `required`.
