// src/render.js — Canvas 2D rendering.
// This is the ONLY layer that flips world y to screen y. All audio/spatial
// math elsewhere uses world coordinates (y increases UP); here y increases
// downward (canvas pixels), so worldToScreen negates y.
//
// Visuals are a high-contrast secondary representation. The player is drawn as
// one outlined shape, the target as a different outlined shape, plus the
// connecting line between them. Respects prefers-color-scheme via a media query.

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const darkQuery =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  return { canvas, ctx, darkQuery };
}

// Map a world point {x,y} to screen pixel coordinates for the given bounds.
// World x increases right, world y increases UP. Canvas y increases DOWN, so
// the y axis is flipped here (and only here).
function worldToScreen(wx, wy, bounds, width, height) {
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const sx = ((wx - bounds.minX) / worldW) * width;
  const sy = height - ((wy - bounds.minY) / worldH) * height; // flip y
  return { sx, sy };
}

export function draw(renderer, world, spatial) {
  const { ctx, canvas, darkQuery } = renderer;
  const width = canvas.width;
  const height = canvas.height;

  const dark = darkQuery ? darkQuery.matches : true;
  const bg = dark ? '#000000' : '#ffffff';
  const fg = dark ? '#ffffff' : '#000000';
  const playerColor = dark ? '#4dd2ff' : '#0050b3'; // cool tone
  const targetColor = dark ? '#ffd24d' : '#b34700'; // warm tone

  const { bounds, player, target } = world;

  // Background.
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const p = worldToScreen(player.x, player.y, bounds, width, height);
  const t = worldToScreen(target.x, target.y, bounds, width, height);

  // Connecting line between player and target.
  ctx.strokeStyle = fg;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(p.sx, p.sy);
  ctx.lineTo(t.sx, t.sy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Target: outlined diamond (square rotated 45 degrees).
  const tR = 16;
  ctx.beginPath();
  ctx.moveTo(t.sx, t.sy - tR);
  ctx.lineTo(t.sx + tR, t.sy);
  ctx.lineTo(t.sx, t.sy + tR);
  ctx.lineTo(t.sx - tR, t.sy);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = targetColor;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Player: outlined circle.
  const pR = 14;
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, pR, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = playerColor;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Large high-contrast distance/offset text overlay.
  if (spatial) {
    const dist = Number.isFinite(spatial.distance)
      ? spatial.distance.toFixed(1)
      : '0.0';
    const dx = Number.isFinite(spatial.dx) ? spatial.dx.toFixed(1) : '0.0';
    const dy = Number.isFinite(spatial.dy) ? spatial.dy.toFixed(1) : '0.0';
    const label = `dist ${dist}   dx ${dx}   dy ${dy}`;

    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const tx = 12;
    const ty = 10;
    // Outline for contrast on either background.
    ctx.lineWidth = 4;
    ctx.strokeStyle = bg;
    ctx.strokeText(label, tx, ty);
    ctx.fillStyle = fg;
    ctx.fillText(label, tx, ty);
  }
}
