# Architecture

## Platform choice

Geolight is a **TypeScript web app** (Vite and Canvas 2D, no game engine), shipped as a **progressive web app**.

- **Reach:** it runs in any modern browser on desktop, tablet and phone, can be installed to the home screen, and plays offline. Sharing it takes one link.
- **Size and battery:** the production JS is about 25 KB gzipped. The renderer draws only when something changes, so an idle board uses no CPU or GPU.
- **Store builds later without a rewrite:** wrap `dist/` with **Capacitor** (iOS/Android) or **Tauri** (Windows/macOS/Linux). Platform-specific code is kept behind small adapters (`src/platform/`).

## Layers

```
          ┌──────────────────────────────────────────────┐
  ui/     │ screens, input, HUD, settings      (DOM)     │
          ├───────────────┬──────────────┬───────────────┤
  render/ │ Canvas 2D     │ audio/       │ i18n/         │
          ├───────────────┴──────────────┴───────────────┤
  game/   │ Session (placement, undo, hints), Progress    │
          ├──────────────────────────────────────────────┤
  level/  │ schema · validation · solver                  │
          ├──────────────────────────────────────────────┤
  core/   │ optics engine: tracer, interactions, types,   │
          │ rules           (pure TS, no DOM)             │
          └──────────────────────────────────────────────┘
```

Each layer depends only on the layers below it. `core`, `level` and `game` never touch the DOM, so they run in tests, in Node scripts (solver, level tools) and could run in a Web Worker.

### Optics engine (`src/core`)

- **Entity:** everything on the board (`{ id, type, x, y, angle, params }`). Its behaviour comes from an **EntityType** in a registry. A type contributes:
  - `surfaces(e)`: segments or circles with an *interaction* function,
  - `emit(e)` (sources only): initial rays,
  - `field(e)` (black holes): a gravity field that bends passing light,
  - `isOpen(e, powered)` (gates): switchable structures that drop their surfaces while open,
  - metadata: category, defaults, rotational `symmetry`, `footprint`.
- **Interaction:** what happens when a ray hits a surface: `absorb`, `mirror`, `splitter`, `filter`, `thinOptic` (an ideal lens or curved mirror, using the paraxial `slope −= h/f`), `refract` (Snell's law with total internal reflection and per-channel dispersion), `polarize` (Malus's law), `grating` (the grating equation per colour, with each channel standing for one wavelength), `receiver` (targets). New physics means writing a new interaction.
- **Light** is power per R/G/B channel plus an optional polarization axis. Filters multiply channels; polarizers apply Malus's law and set the axis; other optics keep it. The tracer also records each packet a receiver absorbs, so targets can ask for a polarization. Prisms split multi-channel rays into one ray per channel. The tracer is iterative (a stack, no recursion) and limited by depth, minimum power and segment count, so mirror loops can't hang it.
- **Gravity:** inside a field's reach, light moves in short straight steps (a tenth of its distance to the centre) and turns after each one, so beams curve smoothly and still interact with everything they pass. Each step turns the ray by `rs·b/r³` per unit length, which over a straight pass adds up to the general-relativity deflection `2·rs/b`; on close passes the bent path dips closer and turns further, as in reality. Light that comes within the shadow (2.6·rs) is swallowed.
- **Gates:** the tracer starts with every gate shut, traces, opens the gates whose photocells are powered and traces again until nothing changes. Opening a gate only adds light, so this ends after at most one extra trace per gate and gives the one consistent state.
- **Rules** (`rules.ts`) turn received light into target status and a win. Goals are registered by name (`allTargets`, `anyTargets`), so new modes plug in.

### Levels (`src/level`, `src/levels`)

Levels are versioned JSON (`schema: 1`). Each one lists entities with lock modes (`fixed`, `rotate`, `free`), a tray inventory, an optional goal and a reference **solution**. `parseLevel` validates files and is where migrations go when the schema grows.

The **solver** searches placements, but only on cells the light currently crosses. Tests use it to check that:

1. every level is unsolved at the start,
2. its reference solution wins with 3 stars,
3. multi-piece levels can't be cheesed with a single piece.

### Worlds and progression (`src/level/worlds.ts`, `src/game/campaign.ts`)

Worlds form a tree defined in `src/levels/worlds.json`. Each world introduces one piece and lists its levels in order. `Campaign` holds the progression rules over "is this level solved?", independent of storage and UI:

- a world opens once each parent world has 4 levels solved (`UNLOCK_AFTER`),
- inside an open world, at most 2 unsolved levels are open at once (`OPEN_LEVELS`), so one level can be skipped,
- `next()` suggests the next level, preferring the current world.

The star map (`src/ui/mapScreens.ts`) draws the tree with a tidy-tree layout; worlds with several parents are centred under all of them, with curved lines converging into them. Inside a world, `skyLayout` (`src/ui/constellation.ts`) snakes the level stars through a grid sized to the screen (no overlapping labels, lines never cross), with a stable per-world wobble so it still looks like a constellation.

### Daily puzzle (`src/level/daily.ts`)

A seeded generator turns the date into a level. It walks a laser path with right-angle turns, puts a mirror at each turn and a sink at the end, then hides the mirrors in the tray (or bolts some down at a wrong angle). Depending on the weekday it also adds sensors, splitters with a second sink, decoy pieces and walls. Every candidate is verified (unsolved at the start, solved by its own path, no one-piece shortcut) before it is used, and the same date always produces the same puzzle.

### Session (`src/game/session.ts`)

This is the headless state of one attempt: pieces, tray counts, snapshot undo/redo, hints derived from the reference solution, and star scoring. The UI, the solver and the tests all drive the same API.

### Rendering (`src/render`)

- Canvas 2D with the device pixel ratio capped at 2 (1.25 on "low" quality).
- **Cached layers:** the board background is redrawn only on resize. The beam layer is redrawn only when the traced light changes.
- **Beams:** segments are batched into a handful of `Path2D`s by colour and brightness. The bloom comes from strokes drawn into a 1/5-resolution canvas, upscaled with a light blur so the halos fade out smoothly. This happens only when the light changes and costs almost nothing.
- **Diffuse light:** hundreds of weak rays are added up in a floating-point buffer at glow resolution (each ray deposits its power along its length), smeared to the ray width and mapped to pixels once with a soft curve. Where rays crowd together (near a bulb, at a focus) they really do get brighter, and since nothing is rounded per ray there are no spikes, stripes or moiré.
- **On-demand frames:** a `requestAnimationFrame` loop runs only while something animates (rotation tweens, meters filling, the win celebration) and then stops.
- Portrait screens get the board rotated by 90°, so cells stay large on phones. Input goes through the same view transform.
- Visuals live in `drawers.ts`, keyed by entity type and separate from physics. A new art style or a WebGL renderer can replace them.

### UI, audio, i18n, platform

- The UI is plain DOM: accessible buttons, focus handling, ARIA labels, and keyboard control on the board.
- Audio is synthesised with Web Audio (pentatonic chimes plus a soft delay), so it needs no asset files.
- Strings live in `i18n/en.ts` and `i18n/de.ts`, and level text is localised in place. `en` is the fallback.
- Storage sits behind a `KeyValueStore` interface (localStorage today; Capacitor Preferences or cloud sync later).
- The service worker precaches the whole build. The precache list is generated at build time in `vite.config.ts`.

## Extension points

| To add… | Do this |
| --- | --- |
| a new object (e.g. wave plate, phosphor, corner reflector) | register an `EntityType` in `core/entities`, a drawer in `render/drawers.ts`, and a name in `i18n` |
| new physics | write an `Interaction` in `core/interactions.ts` |
| a new game mode or win condition | `registerGoal('name', rule)` and set `"goal": { "type": "name" }` in a level |
| a level | drop a JSON file into its world folder and list it in `src/levels/worlds.json` (see `docs/LEVELS.md`); tests check it automatically |
| a world | add a folder and an entry in `worlds.json` with its new piece and parent(s); the star map lays it out automatically |
| a language | add `i18n/<lang>.ts` and register it in `LANGUAGES` |
| a theme | create another `Theme` object (`render/theme.ts`) |
| a platform (app stores) | wrap `dist/` with Capacitor or Tauri and swap `platform/storage.ts` if needed |

## Roadmap ideas

- **More content:** portals/fibre optics, moving or rotating mirrors on timers, colour mixing (red + green targets that need yellow), one-way glass, solar cells that open doors, and fresnel losses on glass in a "realistic" world.
- **Modes:** level editor with share codes (the level JSON plus the solver to verify solvability), a time-attack "catch the moving light" mode, and a sandbox. Daily puzzles could gain lenses and colours using the same generate-and-verify approach.
- **Polish:** colour-blind patterns on coloured targets, light theme, haptics on mobile (via a platform adapter), and analytics-free play statistics.
- **Tech:** move tracing into a Web Worker if levels grow very large, and add a WebGL renderer for richer bloom on capable devices.
