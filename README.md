# Spatial Audio Demo

An interactive web demo of a *decomposed* 2D spatial-audio model built for
accessibility. You move a player around a 2D world toward a stationary target
that emits a continuous audio cue, and three independent psychoacoustic cues
encode where the target is relative to you:

- **Distance → loudness** on a logarithmic (decibel) curve.
- **Horizontal (left/right) → stereo panning + inter-aural time difference (ITD).**
- **Vertical (up/down) → low-pass filter** (bright = up, muffled = down).

Each cue can be toggled on and off independently, and every computed value is
shown on screen and announced to a screen reader, so you can hear exactly what
each cue contributes and read the numbers driving it.

**[Try the live demo →](https://ohylli.github.io/spatial-audio-demo/)**

## Why this exists

This started from a Discord discussion about accessibility in games: a blind
player of a 2D game couldn't judge distance to enemies from audio alone and
asked for logarithmic distance dropoff. That thread suggested decomposing the
localization problem into three independent axes, each driven by a different
psychoacoustic cue, since the ear localizes each direction using different
information. I got curious about how that actually *sounds*, so I had Claude Code
build this demo to find out — both as a locator you can play with and as a
teaching artifact that exposes each cue as its own tunable knob.

The demo page itself has a "How it works" section that explains the model, and
`spatial-audio-demo-handoff.md` is the full design document with the
psychoacoustic rationale and the math.

## Running locally

No build step, no dependencies — it's plain ES modules loaded by `index.html`.
Because it uses `import`, it must be served over HTTP (opening the file directly
with `file://` won't work):

```sh
python -m http.server 8000    # then open http://localhost:8000
```
