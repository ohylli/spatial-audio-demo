# Handoff: Spatial Audio Accessibility Demo

## What this is

A small, self-contained web demo (static files, hostable on GitHub Pages, no build step)
that teaches and lets a listener explore a decomposed model of 2D spatial audio for
accessibility. There is a simple 2D world with a movable player character and a single
stationary target that continuously emits an audio cue. As the player moves, the sound's
loudness, left-right placement, and timbre change according to the player's position
relative to the target, so that a blind player could locate the target by ear alone.

The demo is both a usable locator and a teaching artifact. Its most important feature is
that each spatial cue can be toggled independently and its live computed value is shown on
screen and announced to a screen reader. Someone using it should be able to hear exactly
what each cue contributes, and read the exact numbers driving it.

## Motivation and background

This grew out of an accessibility-modding discussion. A player of a 2D game said they
could not judge distance to enemies from audio alone and asked for logarithmic distance
dropoff. The suggested fix decomposed the problem into three independent axes, each using a
different psychoacoustic cue, because the ear localizes each direction using different
information:

- Distance (how far) -> overall loudness on a logarithmic curve.
- Horizontal / x (left or right) -> stereo panning plus an inter-aural time difference (ITD).
- Vertical / y (up or down) -> a low-pass filter, i.e. a brightness/muffling cue.

Loudness perception is roughly logarithmic, which is why we measure sound in decibels. A
naive linear gain falloff crams almost all the perceived change into the last stretch near
the maximum range, leaving the middle of the range sounding flat and unjudgeable. A
logarithmic (decibel) curve makes equal ratios of distance feel like equal loudness steps,
so the whole range becomes usable.

Stereo panning alone (an inter-aural level difference, ILD) is a fairly weak and sometimes
ambiguous horizontal cue. Adding ITD, the tiny delay between a sound reaching one ear
before the other, makes left-right placement much more solid. Together ILD and ITD are the
classic duplex theory of localization.

Panning encodes nothing vertical, so up/down needs a separate cue. Real elevation
perception relies partly on how the outer ear (pinna) filters sound: lower sources tend to
lose high-frequency energy and sound duller. So a low-pass filter tied to vertical position
gives a "brightness = up, muffled = down" axis. In a game context this doubles as a fake
occlusion cue, which fits: something below you is often literally underground.

This demo is essentially a lightweight, hand-rolled approximation of binaural
spatialization built from cheap DSP primitives, with each cue exposed as an independently
tunable knob. That decomposition is the whole pedagogical point, and it has a practical
benefit: each cue can be exaggerated beyond physical realism for clarity, which is often
what accessibility audio actually wants.

## Coordinate convention (read this before writing any math)

Use a math-style world coordinate system to keep the audio reasoning unambiguous:

- x increases to the right. Positive dx means the target is to the player's right.
- y increases upward. Positive dy means the target is above the player.

Define offsets from the player to the target:

    dx = target.x - player.x
    dy = target.y - player.y
    distance = sqrt(dx*dx + dy*dy)

The renderer draws to a canvas whose pixel y increases downward, so the render layer (and
only the render layer) flips y when converting world coordinates to screen coordinates. All
audio math uses the world convention above. This separation is deliberate: it prevents the
classic bug where the low-pass ends up applied to sources above the player instead of below.

## The spatial model (formulas)

Compute a unit direction vector from player to target, then let each component drive one
directional cue while distance alone drives loudness. This keeps the cues decoupled and
distance-independent (direction reflects angle, not absolute offset, which is what we want).

Guard the divide: if distance is below a small epsilon (player essentially on the target),
treat the sound as centered, full gain, neutral brightness, zero ITD.

    ux = dx / distance     // horizontal component of unit direction, in [-1, 1]
    uy = dy / distance     // vertical component of unit direction, in [-1, 1]

### 1. Distance -> logarithmic gain

    gain_dB = -20 * log10( max(distance, refDistance) / refDistance )
    gain_dB = clamp(gain_dB, minGain_dB, 0)
    gain_linear = 10 ^ (gain_dB / 20)

- refDistance is the distance at which gain is 0 dB (full). Start with refDistance = 1
  world unit (or one tile), tune later.
- minGain_dB is the floor, e.g. -60 dB, so the far edge is quiet but not silent.
- This -20 * log10(...) form gives about -6 dB per doubling of distance (inverse-square law).

### 2. Horizontal (ux) -> panning + ITD

Panning (ILD). Use ux directly as the pan position in [-1, 1]. If you use a
StereoPannerNode it already applies a constant-power (sin/cos) law, so a target moving
across center will not dip in loudness. If you instead do panning by hand with two gains
(see the ITD note below), apply a constant-power law yourself; do not linear-crossfade.

ITD. Derive the horizontal azimuth from ux and apply the Woodworth spherical-head model:

    theta = asin( clamp(ux, -1, 1) )        // radians; 0 = straight ahead, +/- pi/2 = full side
    ITD_seconds = (r / c) * (theta + sin(theta))

    r = 0.0875     // head radius in meters
    c = 343        // speed of sound in m/s

Max ITD is about 0.00066 s (0.66 ms) when the target is directly to one side (theta = pi/2).
Sign of theta (and therefore ux) selects which ear lags: the ear on the far side from the
target is the delayed one.

Because this is a decomposed model with no full HRTF behind the delay, that physical
0.66 ms is perceptually faint in isolation. A UI-tunable exaggeration factor
(`itdExaggeration`, default 1) multiplies the computed ITD so a listener can scale the cue
up until it is clearly audible; at 1 the value stays physically accurate. Keep it well below
~15x so the per-ear delay bias (base +/- ITD/2, base = 5 ms) never clamps at zero.

Raw horizontal variant. Just as the low-pass exposes an angle-vs-raw A/B (below), the
horizontal axis ships one too, as a runtime toggle ("Horizontal: raw mode", key `6`). The
raw source is `panFromDx(dx)` in `spatial.js`: it maps raw horizontal offset `dx` (ignoring
distance) to a horizontal unit in [-1, 1], hard-clamped at `+/- panRawFullWidth` (default 15
world units). This single value feeds **both** horizontal cues — the ILD pan directly, and
the ITD through the same `computeItd` (so `theta = asin(hRaw)`) — so the two stay consistent.
The two sources differ in what they depend on. Angle `ux = dx/distance` encodes pure bearing:
it ignores how far away the target is, so a target due right (dy = 0) pans hard-right at every
distance, and a target with the same `dx` but far above/below pans much closer to center
(because the bearing points mostly up/down). Raw `dx/panRawFullWidth` ignores the vertical
component instead: the same horizontal offset pans the same whether the target is level with
the player or far above, growing with `|dx|` and saturating past `panRawFullWidth`.
`computeSpatial` returns both flavors — `pan`/`theta`/`itdSeconds` (angle) and
`panRaw`/`thetaRaw`/`itdRawSeconds` (raw) — and the consumers (`audio.js`, the readout, the
announcement) select which is active from the toggle. Because it drives pan and ITD, the raw
mode is a *horizontal-source* switch, not a sub-mode of the panning toggle: it affects the
sound whenever either the pan or the ITD cue is on. At `|dx| >= panRawFullWidth` it saturates
to full left/right, reaching the same extremes as the angle source at the side.

### 3. Vertical (uy) -> low-pass cutoff

Map uy to a low-pass cutoff frequency. At or above the player (uy >= 0) the sound is fully
bright; below the player it gets progressively muffled.

    // uy in [-1, 1]; below player is uy < 0
    // at or above the player (uy >= 0) the sound is fully bright;
    // below the player it muffles progressively toward uy = -1
    cutoff_Hz = map clamp(uy, -1, 0) from [-1, 0] to [cutoffMin, cutoffMax]

Map only the below-player half of uy and clamp uy >= 0 to cutoffMax, so a purely horizontal
target (uy = 0, directly left/right) stays fully bright and does not muddy the horizontal
cue. Only sources below the player attenuate high frequencies.

Suggested starting values: cutoffMax around 18000 Hz (effectively open) and cutoffMin
around 600 Hz (clearly muffled). A linear map on uy is fine to start; you may prefer to map
on a log-frequency scale so the change sounds perceptually even. Using uy (the angle
component) rather than raw dy keeps this distance-independent and consistent with panning;
if you later want occlusion to feel more binary, mapping raw dy is a reasonable alternative
to expose as a variant.

Both mappings now ship as a runtime toggle ("Low-pass: raw mode", key `5`). The raw variant
is `cutoffFromDy(dy)` in `spatial.js`: it maps raw vertical offset `dy` (ignoring distance)
so the muffling depends only on how far below the target sits, with no left/right influence.
It reaches cutoffMin at `dy <= -cutoffRawFullDepth` (default 15 world units) and stays bright
for `dy >= 0`. `computeSpatial` returns both `cutoffHz` (angle) and `cutoffRawHz` (raw); the
consumers (`audio.js`, the readout, the announcement) select which is active from the toggle,
so the angle-vs-distance trade-off can be A/B compared live. The raw sub-mode only affects the
sound while the low-pass cue itself is on.

### Optional extra distance cue: pulse rate

Strongly recommended and very game-like. If the source is pulsed (see below), map pulse
repetition rate to proximity: faster blips as the player closes in. This "hot/cold" signal
layers on top of the loudness curve and is often easier to act on than loudness alone.

## Audio implementation (Web Audio API)

The model maps almost one-to-one onto native nodes. Suggested graph:

    source (pulsed broadband) 
      -> [ITD stage: ChannelSplitter -> DelayNode on lagging ear -> ChannelMerger]
      -> StereoPannerNode        (pan = ux)      // or hand-rolled ILD gains
      -> BiquadFilterNode        (lowpass, cutoff from uy)
      -> GainNode                (gain_linear from distance)
      -> destination

Notes:

- Prefer hand-rolled ILD when ITD is in the graph. A StereoPannerNode placed *after* the
  ITD split/merge stage receives a stereo signal, and for stereo input the panner partially
  mixes left into right (and vice versa) rather than just attenuating. That re-mixing smears
  the channel separation the ITD stage just created. So when ITD is active, do ILD by hand:
  replace the StereoPannerNode with two GainNodes (one per channel, constant-power) and do
  ILD and ITD together in the split/merge stage. The native StereoPannerNode is only clean
  while the signal is still mono (ITD off); treat "hand-rolled ILD+ITD in one stage" as the
  default and the native panner as the ITD-off variant.
- Mono source into a ChannelSplitter drops a channel. ChannelSplitterNode uses discrete
  channel interpretation, so a mono source feeds channel 0 and leaves channel 1 silent —
  meaning one ear would delay silence. Before the splitter, force the signal onto both
  channels: set the splitter's input node channelCount to 2 with channelCountMode "explicit"
  and channelInterpretation "speakers" (so mono up-mixes to both), or fan the mono into both
  merger inputs explicitly. Verify both ears carry audio before wiring the delays.
- DelayNode cannot go negative; bias it to ramp through zero. delayTime is clamped to >= 0,
  so you cannot swap which ear lags by flipping a single delay through zero without a click.
  Give both ears a base delay and modulate around it:

      leftDelay  = base + ITD/2
      rightDelay = base - ITD/2      // base >= maxITD/2 keeps both >= 0

  Construct each DelayNode with maxDelayTime comfortably above base + maxITD/2, and ramp
  leftDelay/rightDelay (see smoothing below) so the lagging ear switches smoothly at center.
- DelayNode interpolates fractional delays. At 44.1 kHz one sample is about 22.7 us and max
  ITD is about 660 us, giving roughly 30 samples of resolution, which is plenty.

### Source: use a broadband, pulsed sound

This is the single most important audio decision. A pure sine tone localizes poorly: ITD on
a steady tone is phase-ambiguous, and the low-pass cue has almost nothing to act on. Use a
broadband source: short filtered-noise bursts or a click/ping train. Synthesize it on the
fly (no asset loading, and you can tune it live). Pulsing also enables the pulse-rate
distance cue above. A steady broadband bed is an acceptable alternative if you want
continuous sound, but pulsed localizes better and is more informative.

### Required smoothing and edge handling (hard requirements)

- Autoplay policy: an AudioContext starts suspended until a user gesture. Provide an
  explicit Start control, or resume the context on the first keypress. Without this there
  is simply no sound and it looks broken.
- Zipper noise: parameters (gain, pan, cutoff, delay) update every frame as the player
  moves. Never assign AudioParam .value directly each frame; use setTargetAtTime (time
  constant around 0.01 to 0.02 s) or short linear ramps so each parameter glides. This
  matters more here than in a normal game because the sound is the whole point.
- ITD sign-flip at center: when the target crosses from one side to the other, the lagging
  ear switches. A naive hard swap of which channel is delayed clicks exactly at the moment
  localization matters most. Use the base-delay bias from the audio notes above (leftDelay =
  base + ITD/2, rightDelay = base - ITD/2) and ramp both delayTimes so the difference glides
  smoothly through zero rather than swapping instantly.

## Interaction, readout, and accessibility

The person building and using this may be relying entirely on a screen reader, so treat the
demo's own accessibility as a first-class requirement, not a nicety.

- Movement: capture arrow keys and/or WASD, and call preventDefault so the page does not
  scroll. Movement should update world state each frame (or per keypress; your choice, but
  smooth continuous movement demos the cues better).
- Distance announcement: a keyboard shortcut announces the current offset, e.g.
  "5 right, 10 up" or "5 x, 10 up". Implement this with an ARIA live region: a visually
  hidden element with aria-live="polite" (or "assertive" for on-demand announcements) whose
  text content you update on the keypress. Prefer a live region over the Web Speech API's
  speechSynthesis, because the live region uses whatever screen reader and voice the user
  already has, instead of talking over it with a second voice. If you want the demo to speak
  for sighted users with no screen reader, offer speechSynthesis as an opt-in fallback only,
  so it does not double-speak.
- Additional shortcuts worth exposing: re-announce distance; announce bearing; announce the
  raw computed audio values (gain in dB, pan, ITD in microseconds, cutoff in Hz).
- All interactive controls (Start, the per-cue toggles, any sliders) must be real,
  keyboard-operable, labelled elements, reachable and understandable via screen reader.
- Manage focus sensibly on load so a keyboard/screen-reader user lands somewhere useful.

## Teaching features (the reason this demo exists)

- Per-cue isolation toggles: independently enable/disable panning, ITD, and the low-pass.
  A listener should be able to hear what each cue contributes and what the sound collapses
  to without it. This is the highest-value feature; prioritize it.
- Live value display: continuously show the computed distance, dx/dy, gain (dB), pan
  position, ITD (microseconds), and cutoff (Hz). This turns the abstract model into
  something a person can poke at. These values should be both visible on screen and
  available to the screen reader on demand via the announce shortcut.
- HRTF comparison mode (optional but valuable): the native PannerNode has an HRTF panning
  mode that does real binaural spatialization as a black box. Wiring it up as an A/B
  comparison against the hand-rolled three-knob model nicely illustrates that the
  decomposed cues are approximating the same thing HRTF convolution does, just made tunable
  and exaggeratable.

## Visual layer

Keep the visuals as a high-contrast secondary representation; the ARIA live region and
value display carry the actual meaning. Canvas is simplest for the moving character.

- Respect prefers-contrast and prefers-color-scheme.
- Use strong, outlined shapes for the player and the target, and draw the connecting line
  between them.
- Render the distance/offset text large and high-contrast.
- Remember the render layer flips world y to screen y; the audio math does not.

A clean split: the canvas is decorative, the ARIA live region and the on-screen value
readout carry the information.

## Project structure and hosting

Static files on GitHub Pages, no bundler. Use native ES modules (browsers load them without
a build step). A bundler would only earn its keep for TypeScript or a framework, and neither
is needed; the readability of the DSP is part of the deliverable. Suggested layout, adjust
as sensible:

    index.html          // structure, controls, canvas, visually-hidden ARIA live region
    styles.css          // high-contrast styling, prefers-contrast / prefers-color-scheme
    src/main.js         // wiring: context lifecycle, loop, event binding
    src/world.js        // world state (player, target), update logic
    src/spatial.js      // pure math: offsets, distance, ux/uy, gain, theta, ITD, cutoff
    src/audio.js        // Web Audio graph, node management, per-cue toggles, smoothing
    src/input.js        // keyboard handling (movement, shortcuts, preventDefault)
    src/render.js       // canvas drawing, world-to-screen conversion
    src/announce.js     // ARIA live region updates (and optional speechSynthesis fallback)

Keep src/spatial.js free of Web Audio and DOM dependencies (pure functions on numbers) so
the model is testable and readable in isolation.

Hosting gotchas:

- ES modules require the page to be served over http(s); they do not work from a file://
  URL. For local testing use a local server (for example: python3 -m http.server), not by
  opening the file directly. GitHub Pages serves over https, so production is fine.
- Use relative paths for module imports and assets so it works under a project subpath like
  username.github.io/repo/.

## Acceptance checklist

- Sound starts only after a user gesture and does not error on load.
- Moving the player changes loudness (log curve), pan+ITD (left-right), and brightness
  (up=bright, down=muffled), with no clicks or zipper noise, including when crossing center.
- The distance/offset announcement works via an ARIA live region and reads naturally to a
  screen reader without a competing second voice.
- Each of panning, ITD, and low-pass can be toggled independently, and the effect is
  audible.
- Live values (distance, dx, dy, gain dB, pan, ITD us, cutoff Hz) are shown on screen and
  announceable.
- All controls are keyboard-operable and labelled; the page does not scroll on arrow keys.
- High-contrast visuals respect prefers-contrast and prefers-color-scheme.
- Runs as static files on GitHub Pages with no build step, using relative paths.

## Suggested build order

1. World state + input + canvas render (movement working, no audio).
2. spatial.js pure math with the formulas above, plus the on-screen value readout.
3. Audio graph with distance gain only, including Start/resume and setTargetAtTime smoothing.
4. Add panning, then ITD (with smooth through-zero handling), then the low-pass.
5. Pulsed broadband source and optional pulse-rate proximity cue.
6. ARIA live region and announcement shortcuts.
7. Per-cue isolation toggles and the live value display.
8. Optional: HRTF PannerNode comparison mode. 
