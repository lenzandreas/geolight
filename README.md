# Geolight

A calm, glowing 2D puzzle game about light. Place and rotate mirrors, lenses, prisms and filters to guide beams from lasers, light bulbs and sunlight into their targets. Avoid the sensors.

- **83 levels in 11 worlds on a star map.** Each world is a constellation that introduces exactly one new piece: mirror, beam splitter, lens, concave mirror, diverging lens, glass block, colour filter, prism, polarizer, black hole and diffraction grating. The worlds form a tree. A world opens once 4 levels of each parent are solved, and two levels are open at a time inside a world, so being stuck never blocks you completely. Two worlds need several parents at once and combine their pieces: *Polarity* (polarizers, including the famous three-polarizer paradox) and *Event Horizon* (black holes that bend light along curved paths, with gravitational lensing, Einstein rings and twin holes whose pulls cancel). *Spectra* follows the prisms with diffraction gratings, which split one beam into three and bend red the most, the reverse of a prism.
- **Daily puzzle:** a new level every day, generated from the date (the same for everyone), gentle on Mondays and trickier at the weekend, with a streak counter.
- **Sources:** laser (a sharp beam), light bulb (diffuse light that has to be gathered), sunlight (a wide parallel band), all in any colour.
- **Pieces:** mirror, beam splitter, converging and diverging lens, concave mirror, prism (splits white light into colours), colour filter, glass block, polarizer, black hole (bends passing light, swallows what comes too close), diffraction grating (one beam in, three out: straight on, plus a rainbow to each side), shade.
- **Targets:** rings that need enough light (of one colour, a mix such as yellow = red + green, or one polarization) and sensor eyes that must stay dark. When rings need different amounts, the band of each ring is as thick as its need, like a tank.
- **Obstacles:** walls, slits with narrow, sometimes off-centre openings, and gates that open while their solar cell gets enough light.
- Works with mouse, touch and keyboard, in English and German. It plays offline once installed (PWA) and idles at zero CPU when nothing moves.

## Play / develop

```bash
npm install
npm run dev        # http://localhost:5173  (dev-only extras: ?solve applies a level's solution; ?unlock opens the whole star map; #/level/<id> opens any level; #/daily/YYYY-MM-DD any day's puzzle)
npm test           # optics, session, progress, world-structure and level-pack tests (every level is checked to be solvable)
npm run report     # level report: how many perfect solutions each level has, and whether any beats par (slow)
npm run build      # static site in dist/ (open from any web server or sub-path)
npm run preview    # serve the production build
```

### Continuous integration & deployment

`.github/workflows/ci.yml` runs the typecheck, the tests and a production build on every push and pull request. Pushes to `main` that pass are deployed to **GitHub Pages**.

One-time setup: in the repository on GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. The game will then be served at `https://<owner>.github.io/<repo>/`.

### Controls

| Action | Mouse | Touch | Keyboard |
| --- | --- | --- | --- |
| Place a piece | drag from the tray | drag from the tray | focus a tray item, Enter |
| Move | drag | drag | arrow keys |
| Rotate | click a selected piece, scroll wheel, right click, or drag the round handle | tap a selected piece, or drag the handle | Q / E |
| Return to the tray | drag onto the tray | drag onto the tray | Delete |
| Undo / redo | buttons | buttons | Ctrl+Z / Ctrl+Shift+Z |
| Hint (first the level's tip, then where pieces go) | 💡 button | 💡 button | H |

## Project layout

```
src/
  core/        headless optics engine: math, tracer, interactions, entity types, rules
  level/       level schema, validation, brute-force solver
  levels/      the level pack: one folder per world, worlds.json defines the world tree
  game/        session (placement, undo, hints) and saved progress
  render/      Canvas 2D renderer, per-type drawers, theme, view transform
  ui/          screens (menu, star map, world view, game, settings) and input
  audio/       procedural Web Audio sound effects
  i18n/        string tables (en, de)
  platform/    storage adapter and service worker template
tests/         Vitest suites
docs/          architecture and level-design notes
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, extension points and roadmap, and [docs/LEVELS.md](docs/LEVELS.md) for how to write levels.
