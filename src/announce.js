// src/announce.js
// ARIA live region updates. The announcer pushes text into a visually-hidden
// element that carries aria-live, so the user's own screen reader (and voice)
// re-reads it. We intentionally avoid the Web Speech API here so we do not talk
// over the screen reader with a competing second voice.

// createAnnouncer(liveRegionEl) => announcer
//   announcer.announce(text): update liveRegionEl.textContent so a screen reader
//   re-reads it (clear then set on the next tick).
export function createAnnouncer(liveRegionEl) {
  let pending = null;
  // Toggles every announcement so that re-announcing the *same* text (e.g. the
  // user presses the offset key again without moving) still changes the live
  // region's content. Screen readers only speak a live region when its text
  // actually changes; blanking-then-setting is coalesced by some readers, so we
  // also flip an invisible trailing marker to guarantee a difference. A
  // zero-width space is not rendered on screen and not spoken by screen readers.
  let toggle = false;

  function announce(text) {
    if (!liveRegionEl) return;

    toggle = !toggle;
    const message = String(text) + (toggle ? '​' : '');

    // Clear first as well, so readers that DO re-read on any mutation get a
    // clean fresh read rather than a diff of the previous string.
    liveRegionEl.textContent = '';

    if (pending !== null) {
      cancelAnimationFrame(pending);
    }

    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 0);

    pending = schedule(() => {
      pending = null;
      liveRegionEl.textContent = message;
    });
  }

  return { announce };
}
