# Geolight

A calm, glowing 2D puzzle game about light. Place and rotate mirrors, lenses, prisms and filters to guide beams from lasers, light bulbs and sunlight into their targets. Avoid the sensors.

- **12 levels** in three worlds: *Reflections*, *Gathering Light* and *Colours*, from a one-mirror tutorial to a finale that combines everything.
- **Sources:** laser (a sharp beam), light bulb (diffuse light that has to be gathered), sunlight (a wide parallel band), all in any colour.
- **Pieces:** mirror, beam splitter, converging and diverging lens, concave mirror, prism (splits white light into colours), colour filter, glass block, shade.
- **Targets:** rings that need enough light (optionally of one colour only) and sensor eyes that must stay dark.
- Works with mouse, touch and keyboard, in English and German. It plays offline once installed (PWA) and idles at zero CPU when nothing moves.

## Play / develop

```bash
npm install
npm run dev        # http://localhost:5173  (dev-only extras: ?solve applies a level's solution; every level is unlocked via #/level/<id>)
npm test           # optics, session, progress and level-pack tests (every level is checked to be solvable)
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
| Return to the tray | drag off the board | drag off the board | Delete |
| Undo / redo | buttons | buttons | Ctrl+Z / Ctrl+Shift+Z |
| Hint | 💡 button | 💡 button | H |

## Project layout

```
src/
  core/        headless optics engine: math, tracer, interactions, entity types, rules
  level/       level schema, validation, brute-force solver
  levels/      the level pack: one JSON file per level
  game/        session (placement, undo, hints) and saved progress
  render/      Canvas 2D renderer, per-type drawers, theme, view transform
  ui/          screens (menu, level select, game, settings) and input
  audio/       procedural Web Audio sound effects
  i18n/        string tables (en, de)
  platform/    storage adapter and service worker template
tests/         Vitest suites
docs/          architecture and level-design notes
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, extension points and roadmap, and [docs/LEVELS.md](docs/LEVELS.md) for how to write levels.
