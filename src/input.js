// src/input.js
// Keyboard handling: movement (held) plus one-shot shortcuts. All handled keys
// call preventDefault so arrow keys / space do not scroll the page.
//
// Movement keys (tracked as held state, read each frame via getMoveVector):
//   ArrowUp    / w  -> +y   (world convention: up = +y)
//   ArrowDown  / s  -> -y
//   ArrowLeft  / a  -> -x
//   ArrowRight / d  -> +x
//
// Shortcut keys (fire once per fresh keydown, auto-repeat ignored):
//   o -> onAnnounceOffset()     b -> onAnnounceBearing()
//   v -> onAnnounceValues()
//   1 -> onToggle('panning')    2 -> onToggle('itd')    3 -> onToggle('lowpass')
//   4 -> onToggle('pulse')      5 -> onToggle('lowpassRaw')
//   [ -> onAdjustItdExag(-1)    ] -> onAdjustItdExag(+1)   (auto-repeat allowed)
//   Enter / Space -> onStart()

// Normalize a KeyboardEvent to a lookup id: letters lowercased, everything else
// (ArrowUp, Enter, digits, ' ') left as event.key.
function keyId(event) {
  const k = event.key;
  return k.length === 1 ? k.toLowerCase() : k;
}

// key id -> {x?, y?} movement contribution.
const MOVE_KEYS = {
  ArrowUp: { y: 1 },
  w: { y: 1 },
  ArrowDown: { y: -1 },
  s: { y: -1 },
  ArrowLeft: { x: -1 },
  a: { x: -1 },
  ArrowRight: { x: 1 },
  d: { x: 1 },
};

// key id -> cue name for the toggle shortcuts.
const TOGGLE_KEYS = {
  1: 'panning',
  2: 'itd',
  3: 'lowpass',
  4: 'pulse',
  5: 'lowpassRaw',
};

// key id -> ITD-exaggeration step direction. Auto-repeat is allowed for these so
// holding the key ramps the factor.
const ADJUST_KEYS = {
  '[': -1,
  ']': 1,
};

function clampUnit(n) {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

// setupInput(targetEl, handlers) => inputState
export function setupInput(targetEl, handlers = {}) {
  const held = new Set();

  const call = (name, ...args) => {
    const fn = handlers[name];
    if (typeof fn === 'function') fn(...args);
  };

  function onKeyDown(event) {
    const id = keyId(event);
    let handled = false;

    // Movement: track held state (works even while the browser auto-repeats).
    if (MOVE_KEYS[id]) {
      held.add(id);
      handled = true;
    }

    // ITD-exaggeration adjust: fire on every keydown INCLUDING auto-repeat so
    // holding the key ramps the factor smoothly.
    if (ADJUST_KEYS[id] !== undefined) {
      call('onAdjustItdExag', ADJUST_KEYS[id]);
      handled = true;
    }

    // One-shot shortcuts: ignore auto-repeat so holding a key fires once.
    if (!event.repeat) {
      if (id === 'o') {
        call('onAnnounceOffset');
        handled = true;
      } else if (id === 'b') {
        call('onAnnounceBearing');
        handled = true;
      } else if (id === 'v') {
        call('onAnnounceValues');
        handled = true;
      } else if (TOGGLE_KEYS[id]) {
        call('onToggle', TOGGLE_KEYS[id]);
        handled = true;
      } else if (id === 'Enter' || id === ' ' || id === 'Spacebar') {
        call('onStart');
        handled = true;
      }
    } else if (id === ' ' || id === 'Spacebar') {
      // Still swallow space auto-repeat so the page never scrolls.
      handled = true;
    }

    if (handled) event.preventDefault();
  }

  function onKeyUp(event) {
    const id = keyId(event);
    if (MOVE_KEYS[id]) {
      held.delete(id);
      event.preventDefault();
    }
  }

  // Clear held keys when focus leaves so movement does not get stuck.
  function onBlur() {
    held.clear();
  }

  targetEl.addEventListener('keydown', onKeyDown);
  targetEl.addEventListener('keyup', onKeyUp);
  targetEl.addEventListener('blur', onBlur);

  function getMoveVector() {
    let x = 0;
    let y = 0;
    for (const id of held) {
      const m = MOVE_KEYS[id];
      if (m) {
        if (m.x) x += m.x;
        if (m.y) y += m.y;
      }
    }
    return { x: clampUnit(x), y: clampUnit(y) };
  }

  function destroy() {
    targetEl.removeEventListener('keydown', onKeyDown);
    targetEl.removeEventListener('keyup', onKeyUp);
    targetEl.removeEventListener('blur', onBlur);
    held.clear();
  }

  return { getMoveVector, destroy };
}
