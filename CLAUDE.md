# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-contained, static web demo of a *decomposed* 2D spatial-audio model built for
accessibility. A player moves around a 2D world toward a stationary target that emits a
continuous audio cue. Three independent psychoacoustic cues encode the target's position
relative to the player, and each can be toggled on/off so a listener can hear exactly what
each one contributes:

- **Distance → loudness** on a logarithmic (decibel) curve.
- **Horizontal (x) → panning (ILD) + inter-aural time difference (ITD).**
- **Vertical (y) → low-pass filter** (bright = up, muffled = down).

The demo is both a locator and a teaching artifact: every computed cue value is shown
on-screen and announced to a screen reader. `spatial-audio-demo-handoff.md` is the design
document and the authoritative reference for the psychoacoustic model, tuning rationale,
and the math — read it before changing any of the spatial/audio math.

## Running / developing

No build step, no package manager, no test framework. It is plain ES modules loaded
directly by `index.html`. Because it uses `import`, it must be served over HTTP (opening
the file with `file://` will fail on module CORS).

```sh
python -m http.server 8000    # then open http://localhost:8000
```

Deployment target is GitHub Pages (static hosting).

## Architecture

The code is split into single-responsibility ES modules under `src/`, wired together by
`src/main.js`. The layering is deliberate — keep it intact:

- **`spatial.js` — PURE.** All the spatial/audio math (`computeSpatial`, `distanceGain`,
  `computeItd`, `cutoffFromUy`). No DOM, no Web Audio, no side effects. `DEFAULTS` holds
  the model constants (ref distance, head radius, speed of sound, cutoff range). This is
  where the model lives and where it should be unit-testable in isolation.
- **`audio.js`** — the Web Audio graph (`createAudioEngine`). Consumes a spatial solution
  and the toggle state each frame via `engine.update(spatial, toggles)`. Hand-rolls
  ILD+ITD with a splitter → per-ear delay+gain → merger, then a low-pass, then a master
  gain. Also runs a lookahead pulse scheduler (closer = faster blips). No DOM.
- **`world.js`** — world state (player, target, bounds) and `movePlayer` with clamping.
- **`render.js`** — Canvas 2D drawing. **The only layer that flips y for the screen.**
- **`input.js`** — keyboard handling; held movement keys read per-frame via
  `getMoveVector`, plus one-shot shortcut keys.
- **`announce.js`** — pushes text into an ARIA live region for the user's own screen
  reader (deliberately NOT the Web Speech API, to avoid a competing second voice).
- **`main.js`** — integration only: AudioContext lifecycle, the `requestAnimationFrame`
  loop (movement → `computeSpatial` → render + audio), event binding, the on-screen
  readout, and focus/announcement management.

## Conventions that matter

- **Coordinate system: world y increases UP, everywhere.** Positive `dy` means the target
  is *above* the player; positive `dx` means it is to the *right*. Only `render.js`
  negates y to map to canvas pixels. Do not introduce y-flips anywhere else.
- **AudioContext requires a user gesture.** It starts suspended and is resumed in
  `engine.start()`, called from the Start button / Enter / Space.
- **Per-frame audio parameter changes use `setTargetAtTime`** (never direct `.value`
  writes each frame) so gain/pan/ITD/cutoff glide without zipper noise or center clicks.
- **Toggling a cue off neutralizes it cleanly**, it does not bypass nodes: panning →
  center, ITD → zero delay difference, low-pass → cutoff wide open.
- **Accessibility is the point.** Preserve keyboard operability, ARIA live announcements,
  the on-screen numeric readout, and high-contrast rendering when changing UI.
