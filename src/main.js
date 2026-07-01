// src/main.js — integration/wiring layer.
//
// Owns:
//   - the AudioContext lifecycle (start on user gesture),
//   - the requestAnimationFrame loop (movement -> spatial math -> render + audio),
//   - event binding for the Start button, per-cue toggles, and shortcut keys,
//   - the on-screen live value readout,
//   - focus management on load and ARIA live-region announcements.
//
// Coordinate convention: world y increases UP everywhere here; only render.js
// flips y for the canvas.

import { computeSpatial } from './spatial.js';
import { createWorld, movePlayer } from './world.js';
import { createRenderer, draw } from './render.js';
import { createAudioEngine } from './audio.js';
import { setupInput } from './input.js';
import { createAnnouncer } from './announce.js';

// --- Tuning -----------------------------------------------------------------

const MOVE_SPEED = 8; // world units per second at full stick.
const MAX_DT = 0.05; // clamp frame delta so a backgrounded tab does not teleport.

// --- DOM references ---------------------------------------------------------

const canvas = document.getElementById('world-canvas');
const startBtn = document.getElementById('start-btn');
const startStatus = document.getElementById('start-status');
const liveRegion = document.getElementById('live-region');

const toggleEls = {
  panning: document.getElementById('toggle-panning'),
  itd: document.getElementById('toggle-itd'),
  lowpass: document.getElementById('toggle-lowpass'),
  lowpassRaw: document.getElementById('toggle-lowpass-raw'),
  pulse: document.getElementById('toggle-pulse'),
};

const valEls = {
  distance: document.getElementById('val-distance'),
  dx: document.getElementById('val-dx'),
  dy: document.getElementById('val-dy'),
  gain: document.getElementById('val-gain'),
  pan: document.getElementById('val-pan'),
  itd: document.getElementById('val-itd'),
  cutoff: document.getElementById('val-cutoff'),
};

// --- Module instances -------------------------------------------------------

const world = createWorld();
const renderer = createRenderer(canvas);
const engine = createAudioEngine();
const announcer = createAnnouncer(liveRegion);

// Toggle state mirrors the checkboxes; passed to engine.update each frame.
const toggles = {
  panning: toggleEls.panning.checked,
  itd: toggleEls.itd.checked,
  lowpass: toggleEls.lowpass.checked,
  lowpassRaw: toggleEls.lowpassRaw.checked,
  pulse: toggleEls.pulse.checked,
};

// Latest spatial solution, kept for the announcement shortcuts.
let latest = computeSpatial(world.player, world.target);

// --- Actions ----------------------------------------------------------------

// Start/stop the audio engine, toggling on each activation of the button or
// Enter/Space. Keeps the button label, status text, and announcement in sync.
async function toggleAudio() {
  if (engine.isRunning) {
    engine.stop();
    startStatus.textContent = 'Audio stopped';
    startBtn.textContent = 'Start audio';
    announcer.announce('Audio stopped');
    return;
  }

  try {
    await engine.start();
    startStatus.textContent = 'Audio running';
    startBtn.textContent = 'Stop audio';
    announcer.announce('Audio started');
  } catch (err) {
    startStatus.textContent = 'Audio failed to start';
    announcer.announce('Audio failed to start');
    // eslint-disable-next-line no-console
    console.error('Audio start failed:', err);
  }
}

function setToggle(cueName, on) {
  toggles[cueName] = on;
  if (toggleEls[cueName]) toggleEls[cueName].checked = on;
}

function toggleCue(cueName) {
  const next = !toggles[cueName];
  setToggle(cueName, next);
  announceToggle(cueName, next);
}

const CUE_LABELS = {
  panning: 'Panning',
  itd: 'ITD',
  lowpass: 'Low-pass filter',
  lowpassRaw: 'Low-pass raw mode',
  pulse: 'Pulse rate',
};

function announceToggle(cueName, on) {
  announcer.announce(`${CUE_LABELS[cueName]} ${on ? 'on' : 'off'}`);
}

// --- Announcement helpers ---------------------------------------------------

function announceOffset() {
  const dx = latest.dx;
  const dy = latest.dy;
  const h =
    Math.abs(dx) < 0.05
      ? 'centered horizontally'
      : `${Math.abs(dx).toFixed(1)} ${dx > 0 ? 'right' : 'left'}`;
  const v =
    Math.abs(dy) < 0.05
      ? 'centered vertically'
      : `${Math.abs(dy).toFixed(1)} ${dy > 0 ? 'up' : 'down'}`;
  announcer.announce(`${h}, ${v}. Distance ${latest.distance.toFixed(1)}.`);
}

function announceBearing() {
  const { dx, dy, distance } = latest;
  if (distance < 0.05) {
    announcer.announce('On the target.');
    return;
  }
  // Bearing measured clockwise from up (north), 0..360.
  let deg = Math.atan2(dx, dy) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  const dirs = ['north', 'north-east', 'east', 'south-east',
                'south', 'south-west', 'west', 'north-west'];
  const dir = dirs[Math.round(deg / 45) % 8];
  announcer.announce(
    `Bearing ${Math.round(deg)} degrees, ${dir}. Distance ${distance.toFixed(1)}.`
  );
}

// The cutoff actually being heard depends on the low-pass mode: raw mode uses
// the distance-independent dy mapping, otherwise the angle-based uy mapping.
function activeCutoff(s) {
  return toggles.lowpassRaw ? s.cutoffRawHz : s.cutoffHz;
}

function announceValues() {
  const itdUs = Math.round(latest.itdSeconds * 1e6);
  announcer.announce(
    `Gain ${latest.gainDb.toFixed(1)} decibels. ` +
      `Pan ${latest.pan.toFixed(2)}. ` +
      `ITD ${itdUs} microseconds. ` +
      `Cutoff ${Math.round(activeCutoff(latest))} hertz.`
  );
}

// --- On-screen readout ------------------------------------------------------

function updateReadout(s) {
  valEls.distance.textContent = s.distance.toFixed(1);
  valEls.dx.textContent = s.dx.toFixed(1);
  valEls.dy.textContent = s.dy.toFixed(1);
  valEls.gain.textContent = `${s.gainDb.toFixed(1)} dB`;
  valEls.pan.textContent = s.pan.toFixed(2);
  valEls.itd.textContent = `${Math.round(s.itdSeconds * 1e6)} us`;
  valEls.cutoff.textContent = `${Math.round(activeCutoff(s))} Hz`;
}

// --- Input wiring -----------------------------------------------------------

const input = setupInput(canvas, {
  onStart: toggleAudio,
  onToggle: toggleCue,
  onAnnounceOffset: announceOffset,
  onAnnounceBearing: announceBearing,
  onAnnounceValues: announceValues,
});

startBtn.addEventListener('click', toggleAudio);

for (const cueName of Object.keys(toggleEls)) {
  toggleEls[cueName].addEventListener('change', (e) => {
    setToggle(cueName, e.target.checked);
    announceToggle(cueName, e.target.checked);
  });
}

// --- Main loop --------------------------------------------------------------

let lastTime = null;

function frame(now) {
  const t = now / 1000;
  const dt = lastTime === null ? 0 : Math.min(MAX_DT, t - lastTime);
  lastTime = t;

  const move = input.getMoveVector();
  if (move.x !== 0 || move.y !== 0) {
    movePlayer(world, move.x * MOVE_SPEED * dt, move.y * MOVE_SPEED * dt);
  }

  const s = computeSpatial(world.player, world.target);
  latest = s;

  draw(renderer, world, s);
  if (engine.isRunning) engine.update(s, toggles);
  updateReadout(s);

  requestAnimationFrame(frame);
}

// --- Startup ----------------------------------------------------------------

updateReadout(latest);
draw(renderer, world, latest);

// Land keyboard/screen-reader users on the Start control.
startBtn.focus();

requestAnimationFrame(frame);
