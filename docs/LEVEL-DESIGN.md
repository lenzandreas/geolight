# Designing challenging levels, step by step

This is a procedure for writing a new, hard level without being able to see the game and without doing optics in your head. The tools trace the light for you; your job is to make design choices and to react to what the tools print. Follow the steps in order. Do not skip the checks.

Read `docs/LEVELS.md` first for the file format (entity types, parameters, lock modes).

## The three commands

```bash
npm run level -- list
npm run level -- pieces <world>
npm run level -- show <id or file.json> [--solve] [--place type@x,y@angle] [--turn id@angle]
npm run level -- check <id or file.json>
```

- `show` prints the board as text, with the light on it, a table of what every ring and sensor receives, and a list of every beam (where it starts, its direction, its colour and power, what it ends on). `--place` puts a piece on the board for this one picture only; it does not change the file. You can repeat `--place`. A piece with parameters is written `"filter:color=red@5,4@0"`.
- `check` tests the level and ends with `VERDICT: PASS` or `VERDICT: FAIL`, a numbered list of problems and a list of fixes. It takes up to a minute. Add `--deep` for a longer search on big levels.
- `--place` only works on an empty cell. To turn a piece that is already on the board, use `--turn id@angle` (the "Pieces on the board" table shows the ids).
- Coordinates: `x` grows to the right, `y` grows **down**, both start at 0. Angles: 0 = right, 90 = down, 180 = left, 270 = up. A wall at `x,y` covers that one cell unless it has `"params": {"w": …, "h": …}`.
- Mirrors and splitters: for a beam travelling **right**, angle 45 sends it **up** and angle 135 sends it **down**. For a beam travelling **left**, 45 sends it down and 135 sends it up. A splitter does the same with half of the light and lets the other half go straight on. For a beam travelling **up**, 45 sends it right and 135 sends it left; for a beam travelling **down**, 45 sends it left and 135 sends it right. Other angles (15, 30, 60, …) give slanted beams. If you are not sure, try the angle with `show --place` and look.

- Pieces turn in steps of 15°. Give pre-placed pieces angles that are multiples of 15.
- A ring is a disc of radius 0.32 in the middle of its cell. A slanted beam can cross a ring's cell and still miss the ring, so trust the Targets table, not the picture.
- A prism fans white light into a red, a green and a blue beam at slanted angles. Red and green leave close together; put a strict single-colour ring several cells away from the prism, where the beams have separated.
- A polarizer lets through cos² of the angle between the light's polarization and its own axis: 15° apart keeps 0.93, 30° keeps 0.75, 45° keeps 0.5, 60° keeps 0.25, 90° keeps nothing. Unpolarized light always loses half.

Never work out by hand where light goes. Run `show` and read it. (Working out polarizer amounts from the table above, to choose a `required`, is fine.)

## What makes a level hard

A level is hard when the first idea a player has almost works and the real solution needs one more thought. It is not hard because the board is big, has many pieces or has many walls. These are the things that work, roughly from most to least effective. `check` measures the ones marked (measured).

1. **Few solutions** (measured). If many layouts win, any reasonable try wins. Aim for one layout at par, three at most.
2. **A tempting route that fails.** The direct route to a ring exists but breaks a rule: it crosses a sensor, brings too little light, brings a wrong colour to a `strict` ring, or needs one piece more than the tray has. The player has to give up a plan that looked right (measured as "guided search").
3. **A step that shows no progress** (measured). One piece has to be placed where it lights nothing yet, or even takes light away from a ring, and pays off only when a later piece is placed. Players who only chase fuller rings get stuck.
4. **One piece, two jobs.** Par is lower than the number of things to do, so one piece must do two: a mirror hit by two beams, both halves of a splitter used, a filter standing where two beams cross, light going through the same prism twice.
5. **Decoys and a tight par** (measured). Pieces in the tray that the 3-star solution doesn't use. The obvious solution uses them and earns 2 stars.
6. **Exact amounts** (measured). `required` just below what the right split delivers (½, ¼, ⅑, cos²), `strict` rings that off-colour light spoils, `each` rings that need a balanced mix, `pol` rings that need one polarization. Nearly right fails.
7. **Throwing light away.** The solution needs a piece whose only job is to remove light: a filter in front of a strict ring, a mirror that steers a side beam away from a sensor.
8. **Pre-placed pieces as misdirection.** A `rotate` piece that starts at a tempting wrong angle, or that must be turned so the beam misses it. Turning pieces cost the player no tray pieces, so they add difficulty without making the solver slow.
9. **Order and dependence.** A gate that opens only while a solar cell is lit, so a share of the light has to be spent on the cell first.
10. **Narrow approaches.** Rings and solar cells in niches between walls, so that only one beam direction reaches them. This removes more solutions than walls in open space.
11. **Little room.** Walls or other beams occupy the cells where the obvious piece would go, so it must go somewhere less obvious.
12. **An unusual use of a piece.** A grating turned steeply loses one rainbow; a single-colour laser turns a prism into an odd-angle mirror; a black hole swings a beam right round.

Use two to four of these in one level. More than that and the level is confusing instead of hard.

## The procedure

### Step 1. Choose the world and the idea

```bash
npm run level -- list
npm run level -- pieces <world>
```

Pick a world. Read two of its later levels with `show <id> --solve` to see what is normal there. Then write down, in one sentence, the idea: which items from the list above the level will use. Example: "The straight route to the ring crosses a sensor (2), and a decoy mirror makes the long way round look right (5)."

Pick an id (lower-case words with hyphens) that `list` does not show yet.

### Step 2. Write a bare board

Create `src/levels/<world>/<id>.json` with only the grid, the source and an empty tray. Grids of 9×7 to 12×9 work well.

```json
{
  "schema": 1,
  "id": "my-level",
  "name": { "en": "My Level", "de": "Mein Level" },
  "intro": { "en": "…", "de": "…" },
  "grid": { "w": 10, "h": 7 },
  "entities": [
    { "type": "laser", "x": 0, "y": 3, "angle": 0 }
  ],
  "inventory": [],
  "solution": []
}
```

### Step 3. Build the solved board by experiment

Add the solution's pieces one at a time with `--place`, looking at the picture after each one:

```bash
npm run level -- show src/levels/<world>/<id>.json --place splitter@3,3@45
npm run level -- show src/levels/<world>/<id>.json --place splitter@3,3@45 --place mirror@3,0@45
```

Keep going until the light travels a path you like, with 2 to 4 pieces. Make the path turn, split or change colour at every piece: a piece the light merely passes is not part of the puzzle.

### Step 4. Put the rings where the light ends

Read the "Beams" list of your last `show`. For every beam that should be a goal, add a ring (`sink`) in the cell where it ends or in an empty cell it passes through. Set `required` to about 90% of the beam's total power (the list shows it), so that the ring fills but a weaker beam would not. This is a starting value: if `check` later shows unwanted solutions that bring a little less light, raise `required` to just under what your solution delivers. If the beam has one colour, give the ring that `color` and `"strict": true`.

Then copy your `--place` pieces into the file twice:

- into `"solution"`, as `{ "type": "mirror", "x": 3, "y": 0, "angle": 45 }` (include `"params"` for pieces that have them),
- into `"inventory"`, as counts: `{ "type": "mirror", "count": 2 }`.

Run `show <file> --solve`. Every ring must say `FULL` and the result must say `SOLVED`. If not, fix the rings, not the physics.

### Step 5. Add the difficulty

Now apply the idea from step 1. Change one thing at a time and run `show <file> --solve` after each change to confirm the solution still wins.

| To get | Do this |
| --- | --- |
| a tempting route that fails | Run `show <file>` with the obvious wrong placement. Put a `sensor` on a cell that only this wrong light crosses. |
| a step without progress | Arrange the path so that the first piece the light meets sends it away from all rings. |
| one piece, two jobs | Move a ring or the source so that two beams of the solution cross in one cell, and put the piece there. |
| decoys | Add one or two pieces to `"inventory"` that the solution does not use, and set `"par"` to the number of pieces in the solution. |
| exact amounts | Lower or raise `required` until it is just under what the solution delivers. |
| a misleading pre-placed piece | Move one solution piece from the tray to `"entities"` with an `"id"`, `"lock": "rotate"` and a wrong `"angle"`; change its solution step to `{ "id": "m1", "x": …, "y": …, "angle": … }`. |
| narrow approaches | Put walls on two sides of a ring. |

Write the `intro` (English and German): one or two sentences that hint at the idea but do not say where pieces go.

### Step 6. Check, fix, repeat

```bash
npm run level -- check src/levels/<world>/<id>.json
```

Work through the problems it lists, top to bottom. After every change run `show <file> --solve` (the solution must still win), then `check` again.

| The check says | What it means | What to do |
| --- | --- | --- |
| `SHORTCUT: won with N tray piece(s)` | A player can win with fewer pieces than par. The check prints such a solution. | Look at it with `show <file> --place …`. Then put a wall or sensor on one of the cells the check suggests, or raise a ring's `required`, or remove a piece from the tray. |
| `LOOSE: N layouts win` (the verdict is PASS, but the challenge is capped at 2) | Too many different solutions. The `other:` lines show some. | Block them the same way. Rings in niches help most. |
| `solution step … is not needed` | Your own solution has a spare piece. | Remove that step and that tray piece. |
| `the reference solution does not win` | A ring is not full or a sensor is lit. | Run `show <file> --solve` and read the Targets table. |
| `world … may not use …` | The piece belongs to a later world. | Use another piece, or move the file to a world that allows it. |
| `BAR: NOT MET (…)` | Sound, but not hard enough yet. The brackets say what is missing. | Apply the "To make it harder" list, one item at a time. |

A wall that blocks an unwanted solution can also block yours, and a new decoy can open a new shortcut. That is why every change is followed by `show --solve` and `check`.

Reading the rest of the output:

- `Par solutions: N or more (the search ran out of time …)` means the count is a lower bound. Run `check <file> --deep` once at the end to search longer.
- `other:` lines are different winning layouts. A solution that differs only in stray light, or in a filter slid along its beam, is not listed. A second `strict` ring on the unwanted light is another way to remove one.
- The challenge score counts the ticked items of the checklist. The "chasing fuller rings" item counts twice when even 30 kept boards do not find the solution. "Steps that neither fill a ring nor bring light nearer" is judged by a player who always makes the best-looking move next, so a step can be clever without being counted. It is a rough measure made by a program that plays the level hastily, not a guarantee that people find the level hard. The `BAR:` line tells you whether the level is hard enough.

**The bar.** The level is finished when `check <file> --deep` prints `BAR: MET`. That needs a `PASS`, a challenge of **6/8 or more**, and **exactly one** winning layout with the count finished (not "or more"). Use the plain `check` while you work and `--deep` (it can take a few minutes) when the plain check looks good. Only checks of your own level count towards the limit below.

**When to change course, and when to give up.** The bar is high on purpose, and not every idea reaches it. Keep a count of your `check` runs (with and without `--deep`).

- If six changes in a row have not raised the score or lowered the layout count, the idea does not work on this board. Start again at step 3 with a different path. You may start again twice.
- After **20 runs of `check`** in total, or when the third idea is also stuck, stop. Do not keep trying, and do not lower the bar by editing the tools or the tests.
- When you stop without `BAR: MET`: if your best version got `PASS` with 5/8 or more and at most 3 layouts, keep that file and report it as "below the bar", with its check output. Otherwise delete the file and report that no level was produced. Both are acceptable results. A level that falsely claims to meet the bar is not.

### Step 7. Register and test

Add the id to the `levels` list of its world in `src/levels/worlds.json`. The list is ordered from easy to hard; a challenging level goes near the end. Then:

```bash
npm test
```

All tests must pass. Do not edit other levels, the tests or the tools to make them pass.

## Limits you need to know

- **Tray size.** The check proves that no shortcut exists as long as par is 3 or less. From par 4 on it switches to a hunt, which finds most shortcuts but proves nothing. Prefer par 2 to 4 and get the difficulty from the list above, not from more pieces. Pieces with `"lock": "rotate"` are cheap to check, so use them freely.
- **Bulbs and sunlight** (diffuse light) make the check slow and the amounts fuzzy. Use lasers unless the world is about gathering light (lenses, concave mirrors); in those worlds keep the tray at 3 pieces or fewer.
- **Black holes** act from two cells away. Keep them out of trays with more than 2 other pieces.
- **Polarizer-only levels** differ only in angles and in how many polarizers fit on a stretch of beam. Walls that leave a single free cell, and tight `required` values, are what remove extra solutions there.
- **Walls.** A few walls that shape the idea are good. If you need more than about eight to get down to one layout, the idea is too loose: change the path instead.
- A level is not better for being bigger. If a row or column of the grid is empty in the solved picture and holds no decoy route, remove it.
