// src/audio.js — Web Audio graph implementing the decomposed spatial model.
//
// Signal path (per the handoff "Audio implementation" notes):
//
//   noiseSource (looping white noise)
//     -> pulseGain            (gated to produce broadband bursts / a pulse train)
//     -> stereoForce          (up-mixes mono -> both channels BEFORE the splitter)
//     -> splitter (2ch)
//          ch0 (L) -> leftDelay  -> leftGain  -> merger.in0
//          ch1 (R) -> rightDelay -> rightGain -> merger.in1     // hand-rolled ILD+ITD
//     -> merger (2ch)
//     -> lowpass  (BiquadFilter, cutoff from uy)
//     -> masterGain (gain_linear from distance)
//     -> destination
//
// All per-frame parameter changes use setTargetAtTime (no direct .value writes each
// frame) so gain, pan, ITD and cutoff glide without zipper noise or center clicks.

import { DEFAULTS } from './spatial.js';

// --- Tuning constants -------------------------------------------------------

const SMOOTH_TC = 0.015; // setTargetAtTime time constant (~15 ms) for all per-frame params.

// Base delay bias so both per-ear delays stay >= 0 while the ITD difference ramps
// smoothly through zero at center. base must be >= maxITD/2 (~0.33 ms); 5 ms is
// comfortably above that and inaudible as latency.
const BASE_DELAY = 0.005;
// DelayNode maxDelayTime kept comfortably above base + maxITD/2 (~0.00533 s).
const MAX_DELAY_TIME = 0.1;

const CUTOFF_OPEN = DEFAULTS.cutoffMax; // lowpass-off / neutral cutoff (~18 kHz).

// Pulse-rate (proximity) mapping: closer (louder) -> faster blips.
const PULSE_MIN_INTERVAL = 0.12; // s, when right on top of the target.
const PULSE_MAX_INTERVAL = 0.7;  // s, at the far/quiet edge.
// Fixed rate used when the pulse-rate cue is toggled off: still pulsed (pulsing
// aids localization) but distance-independent, so it conveys no proximity.
const PULSE_STEADY_INTERVAL = 0.35; // s.
const PULSE_ATTACK = 0.004;      // s.
const PULSE_DECAY = 0.06;        // s.
const PULSE_PEAK = 0.9;

// Lookahead scheduler timing.
const SCHEDULER_TICK_MS = 25;
const SCHEDULER_LOOKAHEAD = 0.1; // s.

// Constant-power pan law: map pan in [-1, 1] to a pair of per-ear gains whose
// squares sum to 1 (no loudness dip crossing center).
function panToGains(pan) {
  const p = Math.max(-1, Math.min(1, pan));
  const angle = (p + 1) * (Math.PI / 4); // -1 -> 0, 0 -> pi/4, +1 -> pi/2
  return { left: Math.cos(angle), right: Math.sin(angle) };
}

export function createAudioEngine() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  // AudioContext starts suspended; start() resumes it from a user gesture.
  const context = new AudioCtx();

  // --- Build the persistent graph -----------------------------------------

  // Looping white-noise buffer as the broadband source.
  const noiseBuffer = createNoiseBuffer(context, 2);
  let noiseSource = null; // created lazily in start() (buffer sources are one-shot).

  // Pulse gate: baseline 0, driven to short bursts by the scheduler.
  const pulseGain = context.createGain();
  pulseGain.gain.value = 0;

  // Force mono up to a proper 2-channel stereo signal BEFORE the splitter, so a
  // mono source does not leave channel 1 silent (which would delay silence).
  const stereoForce = context.createGain();
  stereoForce.channelCount = 2;
  stereoForce.channelCountMode = 'explicit';
  stereoForce.channelInterpretation = 'speakers';

  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);

  const leftDelay = context.createDelay(MAX_DELAY_TIME);
  const rightDelay = context.createDelay(MAX_DELAY_TIME);
  leftDelay.delayTime.value = BASE_DELAY;
  rightDelay.delayTime.value = BASE_DELAY;

  const leftGain = context.createGain();
  const rightGain = context.createGain();
  const center = panToGains(0);
  leftGain.gain.value = center.left;   // ~0.707
  rightGain.gain.value = center.right; // ~0.707

  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = CUTOFF_OPEN;

  const masterGain = context.createGain();
  masterGain.gain.value = 0; // silent until the first update ramps it up.

  // Wire it together.
  pulseGain.connect(stereoForce);
  stereoForce.connect(splitter);

  splitter.connect(leftDelay, 0);
  splitter.connect(rightDelay, 1);
  leftDelay.connect(leftGain);
  rightDelay.connect(rightGain);
  leftGain.connect(merger, 0, 0);
  rightGain.connect(merger, 0, 1);

  merger.connect(lowpass);
  lowpass.connect(masterGain);
  masterGain.connect(context.destination);

  // --- Pulse scheduler -----------------------------------------------------

  let pulseInterval = PULSE_MAX_INTERVAL;
  let nextPulseTime = 0;
  let schedulerId = null;

  function schedulePulse(t) {
    const g = pulseGain.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(PULSE_PEAK, t + PULSE_ATTACK);
    g.linearRampToValueAtTime(0, t + PULSE_ATTACK + PULSE_DECAY);
  }

  function runScheduler() {
    const horizon = context.currentTime + SCHEDULER_LOOKAHEAD;
    while (nextPulseTime < horizon) {
      schedulePulse(nextPulseTime);
      nextPulseTime += pulseInterval;
    }
  }

  const engine = {
    context,
    isRunning: false,

    // Resume the AudioContext (must be called from a user gesture) and start the
    // pulsed source + scheduler. Idempotent.
    async start() {
      if (this.isRunning) {
        // Still make sure a suspended context (e.g. re-suspended by the browser)
        // gets resumed on a fresh gesture.
        if (context.state === 'suspended') await context.resume();
        return;
      }

      if (context.state === 'suspended') await context.resume();

      noiseSource = context.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;
      noiseSource.connect(pulseGain);
      noiseSource.start();

      nextPulseTime = context.currentTime + 0.05;
      runScheduler();
      schedulerId = setInterval(runScheduler, SCHEDULER_TICK_MS);

      this.isRunning = true;
    },

    // Apply the current spatial values with smoothing. toggles neutralize a cue
    // cleanly when off: distance -> unity gain (full, unattenuated loudness),
    // panning -> center, itd -> zero delay difference, lowpass -> cutoff wide open.
    update(spatial, toggles = {}) {
      const now = context.currentTime;
      const distanceOn = toggles.distance !== false;
      const panning = toggles.panning !== false;
      const itd = toggles.itd !== false;
      const lowpassOn = toggles.lowpass !== false;
      // Raw horizontal sub-mode swaps the angle-based source (ux) for the raw
      // offset (dx) for BOTH horizontal cues below, so pan and ITD stay in sync.
      const horizontalRaw = toggles.horizontalRaw === true;

      // Distance -> loudness. Off => unity gain (0 dB, reference-distance loudness).
      masterGain.gain.setTargetAtTime(distanceOn ? spatial.gainLinear : 1, now, SMOOTH_TC);

      // Horizontal -> constant-power ILD. Off => dead center (equal power).
      const activePan = horizontalRaw ? spatial.panRaw : spatial.pan;
      const pan = panning ? activePan : 0;
      const gains = panToGains(pan);
      leftGain.gain.setTargetAtTime(gains.left, now, SMOOTH_TC);
      rightGain.gain.setTargetAtTime(gains.right, now, SMOOTH_TC);

      // Horizontal -> ITD via base-delay bias. Off => zero difference (both = base).
      // Positive itdSeconds (target to the right) lags the far (left) ear.
      const activeItd = horizontalRaw ? spatial.itdRawSeconds : spatial.itdSeconds;
      const itdSec = itd ? activeItd : 0;
      const ld = BASE_DELAY + itdSec / 2;
      const rd = BASE_DELAY - itdSec / 2;
      leftDelay.delayTime.setTargetAtTime(Math.max(0, ld), now, SMOOTH_TC);
      rightDelay.delayTime.setTargetAtTime(Math.max(0, rd), now, SMOOTH_TC);

      // Vertical -> low-pass cutoff. Off => open (~cutoffMax). The lowpassRaw
      // sub-mode swaps the angle-based mapping (uy) for the raw vertical-offset
      // one (dy); it only matters while the low-pass cue itself is on.
      const activeCutoff = toggles.lowpassRaw ? spatial.cutoffRawHz : spatial.cutoffHz;
      const cutoff = lowpassOn ? activeCutoff : CUTOFF_OPEN;
      lowpass.frequency.setTargetAtTime(cutoff, now, SMOOTH_TC);

      // Optional proximity cue: closer (louder) => faster pulse rate.
      // Off => a fixed steady rate that carries no distance information.
      if (toggles.pulse !== false) {
        const gl = Math.max(0, Math.min(1, spatial.gainLinear));
        pulseInterval =
          PULSE_MIN_INTERVAL + (1 - gl) * (PULSE_MAX_INTERVAL - PULSE_MIN_INTERVAL);
      } else {
        pulseInterval = PULSE_STEADY_INTERVAL;
      }
    },

    // Not part of the required contract, but handy for teardown/testing.
    stop() {
      if (schedulerId !== null) {
        clearInterval(schedulerId);
        schedulerId = null;
      }
      if (noiseSource) {
        try { noiseSource.stop(); } catch (_) { /* already stopped */ }
        noiseSource.disconnect();
        noiseSource = null;
      }
      this.isRunning = false;
    },
  };

  return engine;
}

// White-noise buffer used as the broadband source material.
function createNoiseBuffer(context, seconds) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}
