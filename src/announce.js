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

  function announce(text) {
    if (!liveRegionEl) return;

    const message = String(text);

    // Clear first so that announcing the same (or similar) text twice in a row
    // still triggers a fresh screen-reader read. Some screen readers only
    // re-announce when the live region's text content actually changes, so we
    // blank it and set the new value on the next tick.
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
