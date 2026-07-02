// src/spatial.js — PURE. No DOM, no Web Audio, no side effects.
//
// Implements the decomposed 2D spatial-audio model from the handoff.
// World coordinate convention: x increases to the right, y increases UP.
// All math here uses that convention; only the render layer flips y.

export const DEFAULTS = {
  refDistance: 1,
  minGainDb: -60,
  headRadius: 0.0875,
  speedOfSound: 343,
  itdExaggeration: 1,
  panRawFullWidth: 15,
  cutoffMin: 600,
  cutoffMax: 18000,
  cutoffRawFullDepth: 15,
  epsilon: 1e-4,
};

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// Offsets from player to target and the straight-line distance between them.
// player/target are {x, y} in world coords.
// => { dx, dy, distance }
export function offsets(player, target) {
  const dx = target.x - player.x;
  const dy = target.y - player.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return { dx, dy, distance };
}

// Logarithmic distance -> gain.
//   gain_dB = -20 * log10( max(distance, refDistance) / refDistance )
//   clamped to [minGainDb, 0]; gainLinear = 10^(gainDb / 20)
// => { gainDb, gainLinear }
export function distanceGain(distance, config = DEFAULTS) {
  const { refDistance, minGainDb } = config;
  const effective = Math.max(distance, refDistance);
  let gainDb = -20 * Math.log10(effective / refDistance);
  gainDb = clamp(gainDb, minGainDb, 0);
  const gainLinear = Math.pow(10, gainDb / 20);
  return { gainDb, gainLinear };
}

// Horizontal unit component (ux) -> inter-aural time difference via the
// Woodworth spherical-head model.
//   theta = asin(clamp(ux, -1, 1))
//   itdSeconds = (r / c) * (theta + sin(theta)) * itdExaggeration
// => { theta, itdSeconds }
//
// itdExaggeration is an intentional, non-physical perceptual-tuning knob. At the
// default of 1 the ITD is physically accurate (max ~656 us at full left/right).
// Because this is a decomposed model with no HRTF (no head-shadow spectral cues,
// no pinna filtering) the true delay is perceptually faint on its own, so the UI
// lets a listener scale it up to hear the cue clearly.
export function computeItd(ux, config = DEFAULTS) {
  const { headRadius, speedOfSound, itdExaggeration = 1 } = config;
  const theta = Math.asin(clamp(ux, -1, 1));
  const itdSeconds =
    (headRadius / speedOfSound) * (theta + Math.sin(theta)) * itdExaggeration;
  return { theta, itdSeconds };
}

// Raw horizontal offset (dx, world units) -> horizontal source unit in [-1, 1],
// hard-clamped at +/- panRawFullWidth. Unlike ux this keeps absolute horizontal
// displacement rather than bearing: as the player closes the horizontal gap the
// value drifts toward center even if the target stays off to one side. Feeds both
// the ILD pan and (via computeItd) the ITD in the raw horizontal mode.
// => hRaw (number in [-1, 1])
export function panFromDx(dx, config = DEFAULTS) {
  const { panRawFullWidth } = config;
  return clamp(dx / panRawFullWidth, -1, 1);
}

// Vertical unit component (uy) -> low-pass cutoff frequency.
// Only the below-player half (uy in [-1, 0]) is mapped onto
// [cutoffMin, cutoffMax]; uy >= 0 stays fully bright at cutoffMax.
// => cutoffHz (number)
export function cutoffFromUy(uy, config = DEFAULTS) {
  const { cutoffMin, cutoffMax } = config;
  const u = clamp(uy, -1, 0); // -1 (fully below) .. 0 (at/above)
  const t = u + 1; // 0 at uy=-1, 1 at uy>=0
  return cutoffMin + t * (cutoffMax - cutoffMin);
}

// Raw vertical offset (dy, world units) -> low-pass cutoff. Unlike cutoffFromUy
// this ignores distance, so the muffling depends only on how far below the
// player the target is, not on the elevation angle (no left/right influence).
// Only the below-player half (dy < 0) muffles; dy >= 0 stays fully bright.
// Full muffle at dy <= -cutoffRawFullDepth.
// => cutoffHz (number)
export function cutoffFromDy(dy, config = DEFAULTS) {
  const { cutoffMin, cutoffMax, cutoffRawFullDepth } = config;
  const depth = clamp(-dy, 0, cutoffRawFullDepth); // 0 (at/above) .. full below
  const t = 1 - depth / cutoffRawFullDepth; // 1 bright (dy>=0) .. 0 muffled
  return cutoffMin + t * (cutoffMax - cutoffMin);
}

// Full spatial solution for a player/target pair. The horizontal cues (pan, ITD)
// are provided in two flavors so a listener can A/B them live: the angle-based
// pair (pan/theta/itdSeconds, from ux) and the raw-offset pair
// (panRaw/thetaRaw/itdRawSeconds, from dx). The vertical low-pass has the same
// angle-vs-raw split (cutoffHz vs cutoffRawHz).
// => { dx, dy, distance, ux, uy, gainDb, gainLinear,
//      pan, theta, itdSeconds, panRaw, thetaRaw, itdRawSeconds,
//      cutoffHz, cutoffRawHz }
export function computeSpatial(player, target, config = DEFAULTS) {
  const { dx, dy, distance } = offsets(player, target);

  // Player essentially on the target: centered, full gain, neutral brightness,
  // zero ITD. Guards the divide-by-distance below.
  if (distance < config.epsilon) {
    return {
      dx,
      dy,
      distance,
      ux: 0,
      uy: 0,
      gainDb: 0,
      gainLinear: 1,
      pan: 0,
      theta: 0,
      itdSeconds: 0,
      panRaw: 0,
      thetaRaw: 0,
      itdRawSeconds: 0,
      cutoffHz: config.cutoffMax,
      cutoffRawHz: config.cutoffMax,
    };
  }

  const ux = dx / distance;
  const uy = dy / distance;

  const hRaw = panFromDx(dx, config);

  const { gainDb, gainLinear } = distanceGain(distance, config);
  const { theta, itdSeconds } = computeItd(ux, config); // angle-based horizontal
  const { theta: thetaRaw, itdSeconds: itdRawSeconds } = computeItd(hRaw, config);
  const cutoffHz = cutoffFromUy(uy, config);
  const cutoffRawHz = cutoffFromDy(dy, config);

  return {
    dx,
    dy,
    distance,
    ux,
    uy,
    gainDb,
    gainLinear,
    pan: ux,
    theta,
    itdSeconds,
    panRaw: hRaw,
    thetaRaw,
    itdRawSeconds,
    cutoffHz,
    cutoffRawHz,
  };
}
